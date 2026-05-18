import yaml from "js-yaml";
import type { DeployRequest } from "../types.js";

export interface ArgoEmitOptions {
  manifestRepoUrl: string;
  manifestPath: string;
  targetRevision?: string;
}

export function argoApplicationName(req: DeployRequest): string {
  return `p-${req.subdomain}-${req.branchId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function emitArgoApplicationManifest(req: DeployRequest, opts: ArgoEmitOptions): string {
  const name = argoApplicationName(req);
  const doc = {
    apiVersion: "argoproj.io/v1alpha1",
    kind: "Application",
    metadata: {
      name,
      namespace: "argocd",
      labels: { "atlas.app/project-id": req.projectId, "atlas.app/branch-id": req.branchId }
    },
    spec: {
      project: "atlas-projects",
      source: {
        repoURL: opts.manifestRepoUrl,
        path: opts.manifestPath,
        targetRevision: opts.targetRevision ?? "HEAD"
      },
      destination: { server: "https://kubernetes.default.svc", namespace: "atlas-projects" },
      syncPolicy: {
        automated: { prune: true, selfHeal: true },
        retry: { limit: 5, backoff: { duration: "5s", factor: 2, maxDuration: "3m" } }
      }
    }
  };
  return yaml.dump(doc, { lineWidth: -1 });
}
