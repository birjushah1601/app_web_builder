"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getRitualEngine } from "@/lib/engine/factory";
import type { EditClass } from "@atlas/ritual-engine";
import type { ArtifactKind } from "@atlas/canvas-runtime";
import type { SecurityReport } from "@/components/SecurityReportPanel";
import type { AccessibilityReport } from "@/components/AccessibilityReportPanel";

export interface StartRitualInput {
  projectId: string;
  userTurn: string;
  editClass: EditClass;
  /** Plan PFP — optional user-provided hint that bypasses the architect's
   *  artifactKind classification. Forwarded to engine.start(). */
  artifactKindHint?: ArtifactKind;
  /** Plan SPU — user-supplied reference imagery. Forwarded to engine.start()
   *  which folds it into the architect's priorArtifact so it flows through
   *  to Designer. Empty array → omitted (no behavior change). */
  referenceImages?: ReadonlyArray<{ url: string; caption?: string }>;
}

/** Plain JSON-serializable shape returned to the client. ChatPanel renders
 *  the artifact + roleEvents + developerOutput inline so users see what
 *  the ritual actually produced instead of a silent success. */
export interface StartRitualResult {
  ritualId: string;
  /** Final architect plan when triage passed and pass2 ran. */
  artifact?: unknown;
  /** Every event each role emitted in this ritual chain — architect's
   *  pass1/pass2/needs_input, developer's anthropic/google/reviewer/completed,
   *  plus any failure events. */
  roleEvents: Array<{ eventType: string; payload: unknown }>;
  /** Developer role's diff + summary when the chain reached the developer
   *  step (architect produced an artifact AND editClass !== "cosmetic"). */
  developerOutput?: { diff: string; summary?: string };
  /** Plan C: per-file outcome of writing the developer's diff into the
   *  project's E2B sandbox. Absent when no developer diff was produced
   *  or no SandboxApplier was wired. */
  sandboxApplyResult?: {
    ok: boolean;
    parsed: number;
    written: number;
    failed: number;
    skipped: number;
    files: Array<{
      path: string;
      status: "written" | "skipped" | "failed";
      reason?: string;
      bytesWritten?: number;
    }>;
    parseError?: string;
  };
  /** Plan I: SecurityRole (L4 gate) report when ATLAS_FF_SECURITY_ROLE on
   *  AND the developer produced a real diff. passed=false escalates the ritual. */
  securityReport?: SecurityReport;
  /** Plan I: AccessibilityRole (L5 gate) report when ATLAS_FF_A11Y_ROLE on. */
  accessibilityReport?: AccessibilityReport;
  /** Plan L: > 0 when this ritual was created by the engine's auto-fix loop. */
  fixAttempts?: number;
}

export async function startRitual(input: StartRitualInput): Promise<StartRitualResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getRitualEngine(input.projectId);
  // Task B: snapshot the curated set of "anchor" files from the live
  // sandbox so the architect's prompt can include a "## Current sandbox
  // files" section even on a cold start. readCurrentFilesForProject is
  // failure-safe — returns [] when the sandbox isn't provisioned yet,
  // when E2B is down, or when no files exist. Architect then runs
  // exactly as it does today.
  const { readCurrentFilesForProject } = await import("@/lib/sandbox/read-current-files");
  const currentFiles = await readCurrentFilesForProject(input.projectId);
  const ritualId = await engine.start({
    userTurn: input.userTurn,
    editClass: input.editClass,
    projectId: input.projectId,
    userId,
    ...(input.artifactKindHint ? { artifactKindHint: input.artifactKindHint } : {}),
    ...(currentFiles.length > 0 ? { currentFiles } : {}),
    // Plan SPU — only forward referenceImages when non-empty so the engine's
    // exactOptionalPropertyTypes-driven `=== undefined` checks behave consistently.
    ...(input.referenceImages && input.referenceImages.length > 0
      ? { referenceImages: input.referenceImages }
      : {})
  });
  // Snapshot is in-memory; same engine instance is cached per-request via
  // React `cache()` in factory.ts, so this getRitual() always finds the
  // ritual we just started.
  const snapshot = await engine.getRitual(ritualId);
  return {
    ritualId,
    artifact: snapshot?.artifact,
    roleEvents: snapshot?.roleEvents ?? [],
    developerOutput: snapshot?.developerOutput,
    sandboxApplyResult: snapshot?.sandboxApplyResult,
    securityReport: snapshot?.securityReport as SecurityReport | undefined,
    accessibilityReport: snapshot?.accessibilityReport as AccessibilityReport | undefined,
    fixAttempts: snapshot?.fixAttempts
  };
}
