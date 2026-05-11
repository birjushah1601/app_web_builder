import { z } from "zod";

export const RitualIdSchema = z.string().min(1).brand("RitualId");
export type RitualId = z.infer<typeof RitualIdSchema>;

export const DispatchContextSchema = z.object({
  ritualId: RitualIdSchema,
  graphVersion: z.number().int().nonnegative(),
  userTurn: z.string(),
  projectId: z.string().uuid()
});
export type DispatchContext = z.infer<typeof DispatchContextSchema>;
