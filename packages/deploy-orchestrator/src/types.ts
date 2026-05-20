import { z } from "zod";

export const DeployTargetSchema = z.enum(["preview", "production"]);
export type DeployTarget = z.infer<typeof DeployTargetSchema>;

export const DeployRequestSchema = z
  .object({
    projectId: z.string().uuid(),
    branchId: z.string().min(1),
    imageRef: z.string().regex(/^[^:]+@sha256:[0-9a-f]{64}$/),
    target: DeployTargetSchema,
    subdomain: z.string().min(1).regex(/^[a-z0-9-]+$/),
    apex: z.string().min(1),
    env: z.record(z.string(), z.string()).default({})
  })
  .strict();
export type DeployRequest = z.infer<typeof DeployRequestSchema>;

export const DeploymentPhaseSchema = z.enum([
  "queued",
  "branch-db-provisioning",
  "manifests-applying",
  "argo-syncing",
  "knative-rollout",
  "cert-provisioning",
  "dns-propagating",
  "healthy",
  "failed",
  "rolled-back"
]);
export type DeploymentPhase = z.infer<typeof DeploymentPhaseSchema>;

export const DeployResultSchema = z
  .object({
    deployId: z.string().uuid(),
    request: DeployRequestSchema,
    phase: DeploymentPhaseSchema,
    publicUrl: z.string().url().optional(),
    argoApplicationName: z.string().min(1),
    branchSchemaName: z.string().min(1),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    errorMessage: z.string().optional()
  })
  .strict();
export type DeployResult = z.infer<typeof DeployResultSchema>;
