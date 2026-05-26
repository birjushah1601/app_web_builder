import { z } from "zod";

export const NodeStatusSchema = z.enum([
  "pending", "ready", "running", "done", "failed", "skipped", "blocked"
]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const NodeRunModeSchema = z.enum(["active", "background", "deferred"]);
export type NodeRunMode = z.infer<typeof NodeRunModeSchema>;

export const NodePolicySchema = z.object({
  priority: z.number().int().min(0).default(0),
  runMode: NodeRunModeSchema,
  timeoutMs: z.number().int().positive().optional()
});
export type NodePolicy = z.infer<typeof NodePolicySchema>;

// Full DependencyProfile v1 schema (Plan B). All concerns are optional;
// schemaVersion is a required literal "1".
export const DependencyProfileSchema = z.object({
  schemaVersion: z.literal("1"),
  auth: z.object({
    provider: z.enum(["keycloak", "clerk", "better-auth", "lucia", "auth-js", "none"]),
    config: z.record(z.unknown()).optional()
  }).optional(),
  db: z.object({
    provider: z.enum(["postgres", "neon", "supabase", "none"]),
    connectionStringEnvVar: z.string()
  }).optional(),
  storage: z.object({
    provider: z.enum(["minio", "s3", "none"]),
    bucketEnvVar: z.string()
  }).optional(),
  email: z.object({
    provider: z.enum(["mailpit", "postal", "resend", "postmark", "none"]),
    apiKeyEnvVar: z.string().optional()
  }).optional(),
  jobs: z.object({
    provider: z.enum(["bullmq", "inngest", "trigger-dev", "none"]),
    redisUrlEnvVar: z.string().optional()
  }).optional(),
  payments: z.object({
    provider: z.enum(["lago", "stripe", "none"])
  }).optional(),
  search: z.object({
    provider: z.enum(["meilisearch", "typesense", "algolia", "none"]),
    apiKeyEnvVar: z.string().optional()
  }).optional(),
  errorTracking: z.object({
    provider: z.enum(["glitchtip", "sentry", "none"]),
    dsnEnvVar: z.string().optional()
  }).optional(),
  analytics: z.object({
    provider: z.enum(["posthog", "plausible", "ga", "mixpanel", "none"]),
    apiKeyEnvVar: z.string().optional()
  }).optional(),
  featureFlags: z.object({
    provider: z.enum(["unleash", "launchdarkly", "none"]),
    urlEnvVar: z.string().optional()
  }).optional()
});
export type DependencyProfile = z.infer<typeof DependencyProfileSchema>;

export const ArtifactRefSchema = z.object({
  schemaVersion: z.string(),
  location: z.literal("inline") // Plan A stores artifacts inline in workflow_nodes.artifact
});
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

export const NodeFailureSchema = z.object({
  error: z.string(),
  attempts: z.number().int().nonnegative(),
  lastCheckpointId: z.string().uuid().optional()
});
export type NodeFailure = z.infer<typeof NodeFailureSchema>;

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  artifactKind: z.string().min(1), // "frontend-app" | "backend-rest-api" | ... | "workflow-planner"
  summary: z.string(),
  dependsOn: z.array(z.string()),
  consumes: z.array(z.string()),
  policy: NodePolicySchema,
  status: NodeStatusSchema,
  ritualId: z.string().optional(),
  artifactRef: ArtifactRefSchema.optional(),
  artifact: z.unknown().optional(), // typed payload; validated against artifact-contracts on assignment
  failure: NodeFailureSchema.optional()
}).superRefine((node, ctx) => {
  // consumes MUST be a subset of dependsOn (Section 5 invariant)
  const depSet = new Set(node.dependsOn);
  for (const c of node.consumes) {
    if (!depSet.has(c)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["consumes"],
        message: `consumes entry "${c}" is not in dependsOn`
      });
    }
  }
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowStatusSchema = z.enum([
  "planning", "awaiting_approval", "running", "completed", "escalated", "aborted"
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const WorkflowEdgeSchema = z.object({
  from: z.string(),
  to: z.string()
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowRunSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string().min(1),
  prompt: z.string(),
  status: WorkflowStatusSchema,
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  dependencyProfile: DependencyProfileSchema,
  concurrencyCap: z.number().int().positive().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export type WorkflowRunSnapshot = WorkflowRun;
