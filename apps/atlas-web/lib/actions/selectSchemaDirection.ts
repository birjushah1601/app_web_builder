"use server";
/**
 * selectSchemaDirection — Server Action that resolves the canvas pause
 * for a ritual whose Schema Architect proposal the user just clicked on.
 *
 * Flow:
 *   user clicks a card in <SchemaArchitectCanvas>
 *     → CanvasShellWired calls selectSchemaDirection({ ritualId, directionId })
 *       → this action grabs the process-singleton CanvasPauseRegistry
 *       → calls registry.resolveOption(ritualId, { directionId })
 *         → engine's awaiting `_runRitual` resumes with the user's choice
 *           and chains into the next role with the selected schema direction.
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
import type { SchemaDirection } from "@atlas/role-schema-architect";

export interface SelectSchemaDirectionInput {
  ritualId: string;
  directionId: string;
  /** The full SchemaDirection (contract + dataModel) ridden through the
   *  registry's opaque `tokens` field so the engine's developer-dispatch
   *  can fold it into priorArtifact. Without this the developer would
   *  only see the directionId and have to re-fetch the proposal. */
  direction?: SchemaDirection;
}

export async function selectSchemaDirection(input: SelectSchemaDirectionInput): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  if (!input.ritualId) throw new Error("selectSchemaDirection: ritualId is required");
  if (!input.directionId) throw new Error("selectSchemaDirection: directionId is required");

  const registry = getCanvasPauseRegistry();
  registry.resolveOption(input.ritualId, {
    directionId: input.directionId,
    tokens: input.direction
  });
}
