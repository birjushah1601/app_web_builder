"use server";
/**
 * submitClarificationAnswers — Server Action that resolves the canvas
 * pause for a ritual whose architect's pass-1 triage emitted blocker
 * questions and is now awaiting the user's answers (Plan U slice 3).
 *
 * Flow:
 *   user fills <TriageClarificationForm> in ChatPanel + clicks "Send answers"
 *     → ChatPanel calls submitClarificationAnswers({ ritualId, answers })
 *       → this action grabs the process-singleton CanvasPauseRegistry
 *       → calls registry.resolveTriageClarifications(ritualId, answers)
 *         → engine's awaiting _runRitual resumes with the user's answers
 *           and chains into architect's pass-2 (deepPlan) WITHOUT
 *           re-running triage (it already classified the questions).
 *
 * Mirrors `selectDesignDirection`'s shape — same process-wide registry
 * pattern, same idempotency (a second call no-ops inside the registry,
 * which covers stale React retries / double-click scenarios).
 */
import { auth } from "@/lib/auth/clerk-compat";
import { getCanvasPauseRegistry } from "@/lib/engine/canvas-pause-singleton";

export interface SubmitClarificationAnswersInput {
  ritualId: string;
  /** Keyed by question id (or by index "q<N>" when the architect didn't
   *  supply ids). The engine threads this into priorArtifact.userAnswers
   *  so deepPlan can read them deterministically. */
  answers: Readonly<Record<string, string>>;
}

export async function submitClarificationAnswers(input: SubmitClarificationAnswersInput): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  if (!input.ritualId) throw new Error("submitClarificationAnswers: ritualId is required");
  if (!input.answers || typeof input.answers !== "object") {
    throw new Error("submitClarificationAnswers: answers must be a Record<string, string>");
  }

  const registry = getCanvasPauseRegistry();
  registry.resolveTriageClarifications(input.ritualId, input.answers);
}
