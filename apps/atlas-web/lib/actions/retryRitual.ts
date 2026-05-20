"use server";

/**
 * Plan #14 — Retry handler for the chat's escalation banner.
 *
 * The ritual engine has no first-class "retry" API today (escalation is
 * terminal — the conductor's policy.maxAttempts has been exhausted). This
 * action is intentionally a stub: it logs the request via console.warn so
 * the chain is visible in dev-server stdout, and returns ok=true so the
 * UI can clear its busy state. A future spec will wire this to a real
 * engine.retry(parentRitualId) method that re-runs the lineage with the
 * same userTurn / parent context.
 *
 * Constraint from the issue: do NOT change engine or role files.
 */

import { auth } from "@/lib/auth/clerk-compat";

export interface RetryRitualInput {
  ritualId: string;
}

export interface RetryRitualResult {
  ok: boolean;
  /** Always "stub" today — flips to "engine.retry" when the engine
   *  surface lands. Kept on the response so the UI can branch on it
   *  without parsing log output. */
  mode: "stub" | "engine.retry";
}

export async function retryRitual(
  input: RetryRitualInput
): Promise<RetryRitualResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  // No-op stub. Logged loudly so QA can confirm the click reached the
  // server during manual testing.
  console.warn(
    `[atlas-web] retryRitual stub invoked for ritualId=${input.ritualId} userId=${userId} — engine.retry not implemented yet`
  );
  return { ok: true, mode: "stub" };
}
