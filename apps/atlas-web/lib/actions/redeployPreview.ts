"use server";

/**
 * redeployPreview — manual recovery for when the E2B sandbox has been
 * killed (idle timeout, manual eviction, etc.) and the user wants to
 * see the last generated site again without re-running the full ritual.
 *
 * Flow:
 *   1. Look up the most recent ritual for this project.
 *   2. Pull its developerOutput.diff (the last applied code change) and
 *      sandboxApplyResult from the hydrated snapshot.
 *   3. Evict any cached sandbox session for the project.
 *   4. Reprovision a fresh sandbox via the factory's getOrProvision.
 *   5. Re-apply the diff into the new sandbox.
 *   6. Return the new previewUrl + sandboxId so the client can re-point
 *      its iframe without a full page refresh (today the canvas page
 *      reload is the simpler path, but the URL is returned in case a
 *      future UI wants in-place iframe re-pointing).
 *
 * Idempotent: calling twice in a row reprovisions twice. Cheap relative
 * to ritual cost (1 sandbox boot + 1 file write per call, no LLM).
 *
 * Failure modes returned in the `ok: false` shape:
 *   - No ritual on the project → "no ritual to redeploy" (start one first)
 *   - Latest ritual has no developer diff → "no developer output to redeploy"
 *     (the ritual was cosmetic-only or escalated before developer ran)
 *   - Sandbox provision fails → "sandbox provision failed: <cause>"
 *   - Diff apply fails → "diff apply failed: <cause>"
 */

import { auth } from "@/lib/auth/clerk-compat";
import { getRitualEngine } from "@/lib/engine/factory";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { applyDiff } from "@/lib/sandbox/apply-diff";
import { createSandboxFsAdapter } from "@/lib/sandbox/sandbox-fs-adapter";
import { getLatestRitualForProject } from "@/lib/actions/getLatestRitualForProject";

export interface RedeployPreviewResult {
  ok: boolean;
  previewUrl?: string;
  sandboxId?: string;
  filesWritten?: number;
  error?: string;
}

export async function redeployPreview(projectId: string): Promise<RedeployPreviewResult> {
  const tag = `[redeployPreview ${projectId.slice(0, 8)}]`;
  console.log(`${tag} start`);
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthorized" };
  if (!projectId) return { ok: false, error: "projectId is required" };

  // Pull the latest ritual + its developer diff.
  const latest = await getLatestRitualForProject(projectId);
  if (!latest) {
    console.log(`${tag} no ritual found`);
    return { ok: false, error: "no ritual to redeploy — start one first" };
  }
  console.log(`${tag} found ritual ${latest.ritualId.slice(0, 12)}`);

  const engine = await getRitualEngine(projectId);
  const snapshot = await engine.getRitual(latest.ritualId);
  const diff = snapshot?.developerOutput?.diff;
  console.log(`${tag} snapshot=${snapshot ? "yes" : "no"} diff.length=${typeof diff === "string" ? diff.length : "n/a"}`);
  if (typeof diff !== "string" || diff.length === 0) {
    return { ok: false, error: "no developer output to redeploy on this ritual" };
  }

  // Evict + provision fresh.
  const factory = getSandboxFactory();
  factory.evict(projectId);

  let session: Awaited<ReturnType<typeof factory.getOrProvision>>;
  try {
    session = await factory.getOrProvision(projectId);
  } catch (err) {
    return { ok: false, error: `sandbox provision failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // Apply diff to the new sandbox.
  try {
    const { Sandbox } = await import("@e2b/sdk");
    const sdk = await Sandbox.connect(session.record.sandboxId, {
      apiKey: process.env.E2B_API_KEY ?? ""
    });
    const fs = createSandboxFsAdapter(sdk as never);
    const applyResult = await applyDiff(fs, diff);
    const fileSummary = Array.isArray(applyResult.files)
      ? applyResult.files.map((f) => `${f.path ?? "?"}=${f.status ?? "?"}`).slice(0, 12).join(",")
      : "no-file-list";
    console.log(`${tag} apply ok=${applyResult.ok} written=${applyResult.written} parsed=${applyResult.parsed} failed=${applyResult.failed} skipped=${applyResult.skipped}${applyResult.parseError ? ` parseError=${applyResult.parseError}` : ""} previewUrl=${session.previewUrl} sandboxId=${session.record.sandboxId.slice(0, 12)} files=[${fileSummary}]`);
    return {
      ok: applyResult.ok,
      previewUrl: session.previewUrl,
      sandboxId: session.record.sandboxId,
      filesWritten: applyResult.written,
      ...(applyResult.parseError ? { error: applyResult.parseError } : {})
    };
  } catch (err) {
    return {
      ok: false,
      previewUrl: session.previewUrl,
      sandboxId: session.record.sandboxId,
      error: `diff apply failed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}
