import { z } from "zod";

export const AuditActorKindSchema = z.enum(["user", "system", "service", "anonymous"]);
export type AuditActorKind = z.infer<typeof AuditActorKindSchema>;

export const AuditActorSchema = z
  .object({
    kind: AuditActorKindSchema,
    /** Stable identifier — Clerk user id, service name, etc. */
    id: z.string().min(1),
    /** Human-friendly label (email, display name, service title). */
    display: z.string().optional(),
    /** Originating IP — null for service / system actors. */
    ip: z.string().optional(),
    /** User agent — null for non-browser actors. */
    userAgent: z.string().optional()
  })
  .strict();
export type AuditActor = z.infer<typeof AuditActorSchema>;

/**
 * Action verbs are kept minimal + closed; new verbs require schema bump
 * to ensure receiver dashboards (Datadog, Splunk, S3-Athena) can pre-build queries.
 */
export const AuditActionSchema = z.enum([
  "auth.login",
  "auth.logout",
  "auth.failed",
  "project.created",
  "project.deleted",
  "project.updated",
  "ritual.started",
  "ritual.approved",
  "ritual.risk-accepted",
  "ritual.escalated",
  "deploy.initiated",
  "deploy.succeeded",
  "deploy.failed",
  "deploy.rolled-back",
  "merge-gate.passed",
  "merge-gate.failed",
  "merge-gate.bypassed",
  "spend.cap-warned",
  "spend.cap-exceeded",
  "settings.updated",
  "audit.export-requested"
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditOutcomeSchema = z.enum(["success", "failure", "denied"]);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

export const AuditEventSchema = z
  .object({
    /** UUIDv7 — sortable by time, unique. */
    id: z.string().uuid(),
    /** ISO timestamp; clock should be NTP-synced. */
    timestamp: z.string().datetime(),
    actor: AuditActorSchema,
    action: AuditActionSchema,
    outcome: AuditOutcomeSchema,
    /** The thing the action was applied to (NodeId, projectId, etc.). */
    targetRef: z.string().min(1),
    /** Tenant scope — every event MUST be tenant-scoped. */
    projectId: z.string().uuid(),
    /** Free-form structured detail; receivers can index but not depend on shape. */
    detail: z.record(z.string(), z.unknown()).default({})
  })
  .strict();
export type AuditEvent = z.infer<typeof AuditEventSchema>;
