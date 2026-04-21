import { z } from "zod";

const BaseSchema = z.object({
  ritualId: z.string().min(1),
  projectId: z.string().min(1),
  ts: z.string()
});

const Required = BaseSchema.extend({ type: z.literal("bootstrap.required") });
const Passed = BaseSchema.extend({
  type: z.literal("bootstrap.passed"),
  payload: z.object({ itemKeys: z.array(z.string()) })
});
const Failed = BaseSchema.extend({
  type: z.literal("bootstrap.failed"),
  payload: z.object({
    failedKeys: z.array(z.string()).min(1),
    notes: z.record(z.string(), z.string())
  })
});
const Escalation = BaseSchema.extend({
  type: z.literal("bootstrap.escalation_requested"),
  payload: z.object({
    freeText: z.string().min(1),
    requestedReviewer: z.enum(["priya"])
  })
});

export const BootstrapEventSchema = z.discriminatedUnion("type", [Required, Passed, Failed, Escalation]);
export type BootstrapEvent = z.infer<typeof BootstrapEventSchema>;
