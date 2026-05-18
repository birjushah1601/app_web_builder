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

  // Reuse the cached sandbox if it's still alive. Only evict + reprovision
  // when the existing one fails the Sandbox.connect / apply path with a
  // "paused / not found" signal — that's the same retry pattern the engine
  // factory uses on the developer-completed apply step. The previous
  // implementation evicted unconditionally on every redeploy click, which
  // meant burning a fresh E2B sandbox every time and leaving the old one
  // to be cleaned up by E2B's idle timer.
  const factory = getSandboxFactory();

  const isStaleSandboxError = (err: unknown): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return /paused\s+sandbox.*not\s+found|sandbox\s+not\s+found|sandbox.*was\s+killed/i.test(msg);
  };

  const applyOnSession = async (
    session: Awaited<ReturnType<typeof factory.getOrProvision>>
  ): Promise<RedeployPreviewResult> => {
    const { Sandbox } = await import("@e2b/sdk");
    const sdk = await Sandbox.connect(session.record.sandboxId, {
      apiKey: process.env.E2B_API_KEY ?? ""
    });
    const fs = createSandboxFsAdapter(sdk as never);
    const applyResult = await applyDiff(fs, diff);
    const fileSummary = Array.isArray(applyResult.files)
      ? applyResult.files.map((f) => `${f.path ?? "?"}=${f.status ?? "?"}`).slice(0, 12).join(",")
      : "no-file-list";
    let assetSync = "skipped";
    try {
      const { syncAtlasAssetsToSandbox } = await import("@/lib/sandbox/sync-atlas-assets");
      const sync = await syncAtlasAssetsToSandbox(sdk as never);
      assetSync = `copied=${sync.copied}/failed=${sync.failed}`;
    } catch (err) {
      assetSync = `error=${err instanceof Error ? err.message : String(err)}`;
    }
    console.log(`${tag} apply ok=${applyResult.ok} written=${applyResult.written} parsed=${applyResult.parsed} failed=${applyResult.failed} skipped=${applyResult.skipped}${applyResult.parseError ? ` parseError=${applyResult.parseError}` : ""} previewUrl=${session.previewUrl} sandboxId=${session.record.sandboxId.slice(0, 12)} files=[${fileSummary}] assets=${assetSync}`);
    return {
      ok: applyResult.ok,
      previewUrl: session.previewUrl,
      sandboxId: session.record.sandboxId,
      filesWritten: applyResult.written,
      ...(applyResult.parseError ? { error: applyResult.parseError } : {})
    };
  };

  // First try: reuse whatever the factory hands us. getOrProvision returns
  // the cached session when present, otherwise provisions on demand.
  let session: Awaited<ReturnType<typeof factory.getOrProvision>>;
  try {
    session = await factory.getOrProvision(projectId);
  } catch (err) {
    return { ok: false, error: `sandbox provision failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  try {
    return await applyOnSession(session);
  } catch (err) {
    if (!isStaleSandboxError(err)) {
      return {
        ok: false,
        previewUrl: session.previewUrl,
        sandboxId: session.record.sandboxId,
        error: `diff apply failed: ${err instanceof Error ? err.message : String(err)}`
      };
    }
    // Cached session points at a dead sandbox — evict and reprovision once,
    // then re-apply. Matches the engine factory's retry-on-stale path.
    console.log(`${tag} cached sandbox stale, evicting + reprovisioning`);
    factory.evict(projectId);
    try {
      session = await factory.getOrProvision(projectId);
    } catch (retryErr) {
      return { ok: false, error: `sandbox reprovision failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}` };
    }
    try {
      return await applyOnSession(session);
    } catch (retryApplyErr) {
      return {
        ok: false,
        previewUrl: session.previewUrl,
        sandboxId: session.record.sandboxId,
        error: `diff apply failed after reprovision: ${retryApplyErr instanceof Error ? retryApplyErr.message : String(retryApplyErr)}`
      };
    }
  }
}
