import { z } from "zod";

export const PersonaTierSchema = z.enum(["ama", "diego", "priya"]);
export type PersonaTier = z.infer<typeof PersonaTierSchema>;

export const HealthLightSchema = z.enum(["green", "amber", "red", "unknown"]);
export type HealthLight = z.infer<typeof HealthLightSchema>;

export const HealthSummarySchema = z
  .object({
    light: HealthLightSchema,
    availabilityRatio: z.number().min(0).max(1),
    openAlerts: z.number().int().nonnegative(),
    windowFromIso: z.string().datetime(),
    windowToIso: z.string().datetime()
  })
  .strict();
export type HealthSummary = z.infer<typeof HealthSummarySchema>;

export const EndpointStatSchema = z
  .object({
    endpointId: z.string().min(1),
    requestCount: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    p50Ms: z.number().nonnegative(),
    p95Ms: z.number().nonnegative(),
    p99Ms: z.number().nonnegative()
  })
  .strict();
export type EndpointStat = z.infer<typeof EndpointStatSchema>;

export const TraceLinkSchema = z
  .object({
    traceId: z.string().regex(/^[0-9a-f]{32}$/),
    rootEndpoint: z.string().min(1),
    durationMs: z.number().nonnegative(),
    errorOccurred: z.boolean(),
    startedAtIso: z.string().datetime()
  })
  .strict();
export type TraceLink = z.infer<typeof TraceLinkSchema>;
