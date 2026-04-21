import { z } from "zod";

export const DeveloperOutputSchema = z.object({
  diff: z.string().min(1),
  summary: z.string().min(1),
  testsAdded: z.array(z.string()),
  filesModified: z.array(z.string()).min(1)
});
export type DeveloperOutput = z.infer<typeof DeveloperOutputSchema>;

export const ReviewerVoteSchema = z.object({
  winner: z.enum(["anthropic", "google"]),
  reasoning: z.string().min(1)
});
export type ReviewerVote = z.infer<typeof ReviewerVoteSchema>;

export interface DeveloperInvocation {
  ritualId: string;
  userTurn: string;
  graphSlice: { bytes: string; hash: string };
  /** Architect-emitted artifact, JSON-serialized into the prompt. */
  architectArtifact: unknown;
}
