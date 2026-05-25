import { z } from "zod";

export const GenericArtifactSchema = z.object({
  schemaVersion: z.string().min(1),
  kind: z.string().min(1),
  payload: z.unknown()
});
export type GenericArtifact = z.infer<typeof GenericArtifactSchema>;
