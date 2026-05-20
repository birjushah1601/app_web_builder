"use server";
/**
 * selectDesignDirection — Server Action that resolves the canvas pause
 * for a ritual whose Designer proposal the user just clicked on.
 *
 * Flow:
 *   user clicks a card in <DesignerCanvas>
 *     → CanvasShellWired calls selectDesignDirection({ ritualId, directionId })
 *       → this action grabs the process-singleton CanvasPauseRegistry
 *       → calls registry.resolveOption(ritualId, { directionId, tokens })
 *         → engine's awaiting `_runRitual` resumes with the user's choice
 *           and chains into the developer role with selectedTokens folded
 *           into priorArtifact.
 *
 * The registry is process-wide (not per-request), so the `getRitualEngine`
 * factory (which caches per request) does NOT own it — both the engine
 * (await side) and this action (resolve side) reach into the same
 * singleton.
 *
 * Idempotent: a second call for the same ritualId is a no-op inside the
 * registry. That covers stale React retries / double-click scenarios.
 */
import { auth } from "@/lib/auth/clerk-compat";
import { getCanvasPauseRegistry } from "@/lib/engine/canvas-pause-singleton";

export interface SelectDesignDirectionInput {
  ritualId: string;
  directionId: string;
  /** Optional design tokens for the chosen direction. The engine folds
   *  these into the developer's priorArtifact verbatim; when omitted the
   *  engine sees `tokens: undefined`. */
  tokens?: unknown;
}

export async function selectDesignDirection(input: SelectDesignDirectionInput): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  if (!input.ritualId) throw new Error("selectDesignDirection: ritualId is required");
  if (!input.directionId) throw new Error("selectDesignDirection: directionId is required");

  const registry = getCanvasPauseRegistry();
  registry.resolveOption(input.ritualId, {
    directionId: input.directionId,
    tokens: input.tokens
  });
}
