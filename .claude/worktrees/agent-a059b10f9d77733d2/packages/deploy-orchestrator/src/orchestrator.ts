import { randomUUID } from "node:crypto";
import type { KubernetesClient } from "./kubernetes-client.js";
import type { CloudflareClient } from "./cloudflare-client.js";
import { emitKnativeServiceManifest, knativeServiceName } from "./manifests/knative-service.js";
import { emitArgoApplicationManifest, argoApplicationName } from "./manifests/argo-application.js";
import { emitCertificateManifest, certificateName } from "./manifests/cert-manager-cert.js";
import { reconcileArgoUntilSettled } from "./reconcile.js";
import {
  DeployRequestSchema,
  type DeployRequest,
  type DeployResult
} from "./types.js";
import { DeployError, ManifestEmissionError } from "./errors.js";

export interface BranchingPort {
  ensureBranch(projectId: string, branchId: string): Promise<{ schemaName: string; created: boolean }>;
  dropBranch(projectId: string, branchId: string): Promise<{ schemaName: string; dropped: boolean }>;
  listBranches(projectId: string): Promise<string[]>;
}

export type MigratePort = (input: {
  schemaName: string;
}) => Promise<{ schemaName: string; applied: number; filenames: string[] }>;

export interface DeployOrchestratorOptions {
  kubernetes: KubernetesClient;
  cloudflare: CloudflareClient;
  branching: BranchingPort;
  migrate: MigratePort;
  manifestRepoUrl: string;
  issuerRef: string;
  ingressTarget: string;
  /** Optional: returns a SENTRY_DSN to inject into Knative env when GlitchTip is configured for the project. */
  glitchTipDsnFor?: (projectId: string) => string | undefined;
  /** Optional: tune reconcile poll interval + timeout (defaults: 200ms / 60s). */
  reconcileIntervalMs?: number;
  reconcileTimeoutMs?: number;
}

export class DeployOrchestrator {
  constructor(private readonly opts: DeployOrchestratorOptions) {}

  async deploy(input: DeployRequest): Promise<DeployResult> {
    const parsed = DeployRequestSchema.parse(input);
    const deployId = randomUUID();
    const startedAt = new Date().toISOString();

    const branch = await this.opts.branching.ensureBranch(parsed.projectId, parsed.branchId);
    if (branch.created) {
      await this.opts.migrate({ schemaName: branch.schemaName });
    }

    const glitchTipDsn = this.opts.glitchTipDsnFor?.(parsed.projectId);

    let knativeYaml: string;
    let argoYaml: string;
    let certYaml: string;
    try {
      knativeYaml = emitKnativeServiceManifest(parsed, {
        branchSchemaName: branch.schemaName,
        glitchTipDsn
      });
      argoYaml = emitArgoApplicationManifest(parsed, {
        manifestRepoUrl: this.opts.manifestRepoUrl,
        manifestPath: `projects/${parsed.subdomain}/${parsed.branchId}`
      });
      certYaml = emitCertificateManifest(parsed, { issuerRef: this.opts.issuerRef });
    } catch (err) {
      throw new ManifestEmissionError("manifest emit failed", { cause: err });
    }

    const knativeName = knativeServiceName(parsed);
    const argoName = argoApplicationName(parsed);
    const certName = certificateName(parsed);
    const fqdn = `${parsed.subdomain}.${parsed.apex}`;

    await this.opts.kubernetes.apply("atlas-projects", "Service", knativeName, knativeYaml);
    await this.opts.kubernetes.apply("argocd", "Application", argoName, argoYaml);
    await this.opts.kubernetes.apply("atlas-projects", "Certificate", certName, certYaml);

    await this.opts.cloudflare.upsertDnsRecord(parsed.apex, fqdn, "CNAME", this.opts.ingressTarget);

    const health = await reconcileArgoUntilSettled(this.opts.kubernetes, argoName, {
      intervalMs: this.opts.reconcileIntervalMs ?? 200,
      timeoutMs: this.opts.reconcileTimeoutMs ?? 60_000
    });

    if (health !== "Healthy") {
      // Rollback: delete every applied manifest + DNS, then throw.
      await this.opts.cloudflare.deleteDnsRecord(parsed.apex, fqdn);
      await this.opts.kubernetes.delete("atlas-projects", "Certificate", certName);
      await this.opts.kubernetes.delete("argocd", "Application", argoName);
      await this.opts.kubernetes.delete("atlas-projects", "Service", knativeName);
      throw new DeployError(`argo Application ${argoName} reported ${health}; deployment rolled back`);
    }

    return {
      deployId,
      request: parsed,
      phase: "healthy",
      publicUrl: `https://${fqdn}`,
      argoApplicationName: argoName,
      branchSchemaName: branch.schemaName,
      startedAt,
      endedAt: new Date().toISOString()
    };
  }
}
