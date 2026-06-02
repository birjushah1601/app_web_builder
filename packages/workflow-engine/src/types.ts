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

// Plan F.3 — single smoke-test result captured by deploy-orchestrator's
// post-Argo-Healthy HTTP runner. One entry per DeployArtifact.smokeTests[].
export const SmokeTestResultSchema = z.object({
  url: z.string().min(1),
  method: z.enum(["get", "post", "put", "patch", "delete", "head"]),
  status: z.number().int().min(0).max(599),     // 0 = network/timeout failure
  ok: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  expectStatus: z.number().int().min(100).max(599),
  expectBodyContains: z.string().optional(),
  bodyExcerpt: z.string().optional(),            // first 200 chars of response body
  error: z.string().optional()                   // present when ok=false
});
export type SmokeTestResult = z.infer<typeof SmokeTestResultSchema>;

// Plan F.2 — populated by the workflow engine when a deploy-kind node's
// post-producer hook runs `deployRunner` (i.e. the runtime adapter actually
// applied the artifact's manifests via the K8s/Cloudflare clients). Shape
// matches what runDeployFromArtifacts returns from @atlas/deploy-orchestrator.
export const DeployResultSchema = z.object({
  deployId: z.string().min(1),
  publicUrl: z.string().url(),
  argoApplicationName: z.string().min(1),
  branchSchemaName: z.string().min(1),
  appliedManifests: z.array(z.object({
    namespace: z.string().min(1),
    kind: z.string().min(1),
    name: z.string().min(1)
  })),
  phase: z.enum(["healthy", "failed"]),
  startedAt: z.string(),
  // Plan F.3 — present when smoke tests ran post-Argo-Healthy. Omitted when
  // the deploy artifact had no smoke definitions OR smoke runner failed entirely.
  smokeResults: z.array(SmokeTestResultSchema).optional()
});
export type DeployResult = z.infer<typeof DeployResultSchema>;

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
  failure: NodeFailureSchema.optional(),
  // Plan F.2 — present when an artifact-driven deploy ran for this node.
  deployResult: DeployResultSchema.optional()
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
  // Plan G — optional USD cost cap for the run. Engine-internal contract is
  // undefined-when-unset; DB layer (drizzle) may return null which adapters
  // normalize to undefined before constructing the snapshot.
  costCapUsd: z.number().positive().optional(),
  // Plan G — running USD cost tracked across this workflow's LLM calls.
  // Reflects the per-run usage tracker's current total. Optional —
  // omitted when no tracker exists (e.g. terminal cleanup or pre-Plan G).
  totalCostUsd: z.number().nonnegative().optional(),
  // Plan G.3 — per-role spend breakdown. Reflects the live tracker
  // during execution; after the scheduler exits, the engine freezes
  // tracker.breakdown() onto the workflow_runs.cost_breakdown column
  // and buildSnapshot prefers the persisted value. Empty array = no
  // recorded usage; omitted entirely = legacy run / no tracker.
  costBreakdown: z.array(z.object({
    roleId: z.string().min(1),
    totalUsd: z.number().nonnegative(),
    callCount: z.number().int().nonnegative()
  })).optional(),
  concurrencyCap: z.number().int().positive().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export type WorkflowRunSnapshot = WorkflowRun;
