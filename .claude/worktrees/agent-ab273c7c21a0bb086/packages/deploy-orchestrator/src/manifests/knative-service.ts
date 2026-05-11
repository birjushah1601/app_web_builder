import yaml from "js-yaml";
import type { DeployRequest } from "../types.js";

export interface EmitOptions {
  branchSchemaName: string;
  glitchTipDsn?: string;
}

export function knativeServiceName(req: DeployRequest): string {
  return `p-${req.subdomain}-${req.branchId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function emitKnativeServiceManifest(req: DeployRequest, opts: EmitOptions): string {
  const name = knativeServiceName(req);
  const minScale = req.target === "production" ? "1" : "0";
  const env = [
    { name: "DB_SCHEMA", value: opts.branchSchemaName },
    ...Object.entries(req.env).map(([key, value]) => ({ name: key, value }))
  ];
  if (opts.glitchTipDsn) env.push({ name: "SENTRY_DSN", value: opts.glitchTipDsn });
  const doc = {
    apiVersion: "serving.knative.dev/v1",
    kind: "Service",
    metadata: {
      name,
      namespace: "atlas-projects",
      labels: {
        "atlas.app/project-id": req.projectId,
        "atlas.app/branch-id": req.branchId,
        "atlas.app/target": req.target
      }
    },
    spec: {
      template: {
        metadata: {
          annotations: {
            "autoscaling.knative.dev/minScale": minScale,
            "autoscaling.knative.dev/maxScale": "20"
          }
        },
        spec: {
          containerConcurrency: 50,
          containers: [
            {
              image: req.imageRef,
              env,
              resources: {
                requests: { cpu: "100m", memory: "256Mi" },
                limits: { cpu: "1000m", memory: "1Gi" }
              }
            }
          ]
        }
      }
    }
  };
  return yaml.dump(doc, { lineWidth: -1 });
}
