import { randomUUID } from "node:crypto";
import { load as parseYaml } from "js-yaml";
import type { IacArtifact, DeployArtifact, SmokeTestResult } from "@atlas/workflow-engine";
import type { KubernetesClient } from "./kubernetes-client.js";
import type { CloudflareClient } from "./cloudflare-client.js";
import type { BranchingPort, MigratePort } from "./orchestrator.js";
import { reconcileArgoUntilSettled } from "./reconcile.js";
import { runSmokeTests, type SmokeFetcher } from "./smoke-runner.js";
import {
  buildAndPushImages,
  type CommandRunner,
  type ImageBuilderResult
} from "./image-builder.js";
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
  /** Plan F.4 — injectable command runner for the image builder. Default
   *  (when undefined) spawns docker via child_process. Set to a vi.fn-backed
   *  fake in tests to assert command shape without invoking docker. */
  imageRunner?: CommandRunner;
  /** Plan F.4 — when true, the image builder runs `docker build` only and
   *  skips `docker push`. Useful for local dev + tests where no real
   *  registry exists. */
  skipImagePush?: boolean;
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
  /** Plan F.4 — per-image build+push results. Present when the artifact
   *  declared at least one imageBuild entry. Omitted when the artifact had
   *  no images (no builder invocation). */
  imageBuilds?: ImageBuilderResult[];
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

  // Plan F.4 — build + push every image BEFORE any k8s call. Fail-fast on
  // build error: nothing has been applied yet, so no rollback is needed.
  // The builder itself is fail-soft per-image (each gets a result); we
  // aggregate-throw on any !ok so the failure surface stays clean.
  let imageResults: ImageBuilderResult[] | undefined;
  if (input.deployArtifact.imageBuilds.length > 0) {
    imageResults = await buildAndPushImages(input.deployArtifact.imageBuilds, {
      ...(opts.imageRunner ? { runner: opts.imageRunner } : {}),
      ...(opts.skipImagePush !== undefined ? { skipPush: opts.skipImagePush } : {})
    });
    const failed = imageResults.filter((r) => !r.ok);
    if (failed.length > 0) {
      const detail = failed
        .map((r) => `${r.serviceName}:${r.imageTag} (${r.error ?? "unknown"})`)
        .join(", ");
      throw new DeployError(`${failed.length} image build(s) failed: ${detail}`);
    }
  }

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
      ...(smokeResults.length > 0 ? { smokeResults } : {}),
      ...(imageResults && imageResults.length > 0 ? { imageBuilds: imageResults } : {})
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
