import { randomUUID } from "node:crypto";
import { load as parseYaml } from "js-yaml";
import type { IacArtifact, DeployArtifact, SmokeTestResult } from "@atlas/workflow-engine";
import type { KubernetesClient } from "./kubernetes-client.js";
import type { CloudflareClient } from "./cloudflare-client.js";
import type { BranchingPort, MigratePort } from "./orchestrator.js";
import { reconcileArgoUntilSettled } from "./reconcile.js";
import { runSmokeTests, type SmokeFetcher } from "./smoke-runner.js";
import { DeployError } from "./errors.js";

export interface DeployFromArtifactsOptions {
  kubernetes: KubernetesClient;
  cloudflare: CloudflareClient;
  branching: BranchingPort;
  migrate: MigratePort;
  ingressTarget: string;
  reconcileIntervalMs?: number;
  reconcileTimeoutMs?: number;
  smokeFetcher?: SmokeFetcher;
  smokeTimeoutMs?: number;
}

export interface DeployFromArtifactsInput {
  projectId: string;
  branchId: string;
  subdomain: string;
  apex: string;
  iacArtifact: IacArtifact;
  deployArtifact: DeployArtifact;
}

export interface DeployFromArtifactsResult {
  deployId: string;
  publicUrl: string;
  argoApplicationName: string;
  branchSchemaName: string;
  appliedManifests: Array<{ namespace: string; kind: string; name: string }>;
  phase: "healthy" | "failed";
  startedAt: string;
  smokeResults?: SmokeTestResult[];
}

const DEFAULT_NAMESPACE = "atlas-projects";
const ARGO_NAMESPACE = "argocd";

function extractNamespace(manifestYaml: string): string {
  try {
    const doc = parseYaml(manifestYaml) as { metadata?: { namespace?: unknown } } | null;
    const ns = doc?.metadata?.namespace;
    return typeof ns === "string" && ns.length > 0 ? ns : DEFAULT_NAMESPACE;
  } catch {
    return DEFAULT_NAMESPACE;
  }
}

export async function runDeployFromArtifacts(
  opts: DeployFromArtifactsOptions,
  input: DeployFromArtifactsInput
): Promise<DeployFromArtifactsResult> {
  const deployId = randomUUID();
  const startedAt = new Date().toISOString();
  const fqdn = `${input.subdomain}.${input.apex}`;

  const branch = await opts.branching.ensureBranch(input.projectId, input.branchId);
  if (branch.created) {
    await opts.migrate({ schemaName: branch.schemaName });
  }

  const applied: Array<{ namespace: string; kind: string; name: string }> = [];

  try {
    // Apply IaC k8s manifests in declared order.
    for (const m of input.iacArtifact.k8s.manifests) {
      const ns = extractNamespace(m.content);
      await opts.kubernetes.apply(ns, m.kind, m.name, m.content);
      applied.push({ namespace: ns, kind: m.kind, name: m.name });
    }

    // Apply Argo CD Application.
    await opts.kubernetes.apply(
      ARGO_NAMESPACE,
      "Application",
      input.deployArtifact.argoApplication.name,
      input.deployArtifact.argoApplication.content
    );
    applied.push({
      namespace: ARGO_NAMESPACE,
      kind: "Application",
      name: input.deployArtifact.argoApplication.name
    });

    // DNS.
    await opts.cloudflare.upsertDnsRecord(input.apex, fqdn, "CNAME", opts.ingressTarget);

    // Reconcile Argo health.
    const health = await reconcileArgoUntilSettled(
      opts.kubernetes,
      input.deployArtifact.argoApplication.name,
      {
        intervalMs: opts.reconcileIntervalMs ?? 200,
        timeoutMs: opts.reconcileTimeoutMs ?? 60_000
      }
    );

    if (health !== "Healthy") {
      // Roll back DNS first, then every applied manifest in REVERSE order.
      await opts.cloudflare.deleteDnsRecord(input.apex, fqdn).catch(() => {});
      for (const m of [...applied].reverse()) {
        await opts.kubernetes.delete(m.namespace, m.kind, m.name).catch(() => {});
      }
      throw new DeployError(
        `argo Application ${input.deployArtifact.argoApplication.name} reported ${health}; deployment rolled back`
      );
    }

    // Plan F.3: smoke tests post-Argo-Healthy
    const smokeResults = await runSmokeTests({
      deployArtifact: input.deployArtifact,
      publicUrl: `https://${fqdn}`,
      ...(opts.smokeFetcher ? { fetcher: opts.smokeFetcher } : {}),
      ...(opts.smokeTimeoutMs !== undefined ? { perSmokeTimeoutMs: opts.smokeTimeoutMs } : {})
    });

    const failedSmokes = smokeResults.filter((s) => !s.ok);
    if (failedSmokes.length > 0) {
      await opts.cloudflare.deleteDnsRecord(input.apex, fqdn).catch(() => {});
      for (const m of [...applied].reverse()) {
        await opts.kubernetes.delete(m.namespace, m.kind, m.name).catch(() => {});
      }
      const failedUrls = failedSmokes
        .map((s) => `${s.url} (${s.error ?? `status ${s.status}`})`)
        .join(", ");
      throw new DeployError(
        `${failedSmokes.length} smoke test(s) failed: ${failedUrls}; deployment rolled back`
      );
    }

    return {
      deployId,
      publicUrl: `https://${fqdn}`,
      argoApplicationName: input.deployArtifact.argoApplication.name,
      branchSchemaName: branch.schemaName,
      appliedManifests: applied,
      phase: "healthy",
      startedAt,
      ...(smokeResults.length > 0 ? { smokeResults } : {})
    };
  } catch (err) {
    // On any failure mid-apply (or rethrown rollback above), tear down whatever landed.
    if (err instanceof DeployError) throw err;
    await opts.cloudflare.deleteDnsRecord(input.apex, fqdn).catch(() => {});
    for (const m of [...applied].reverse()) {
      await opts.kubernetes.delete(m.namespace, m.kind, m.name).catch(() => {});
    }
    throw err;
  }
}
