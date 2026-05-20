import { KlingCostCapExceededError } from "./errors.js";
import type { KlingCostCap } from "./types.js";

/**
 * Spend reader for Kling video generation. Matches the shape of the E2B
 * SpendReader — Kling's CostCapConsumer can read from the same billing
 * ledger (`sandbox_spend_log`) with a `kind: "video-kling"` filter, or a
 * separate `video_spend_log` table — choice is up to the caller.
 */
export interface KlingSpendReader {
  getAccumulatedSpendUsd(projectId: string): Promise<number>;
}

/**
 * Enforces the per-project monthly cap before enqueuing a Kling job.
 * Throws KlingCostCapExceededError if the current accumulated spend is at
 * or above the cap. Emits a console.warn when the spend has crossed the
 * warn fraction but is still under the hard cap.
 */
export async function checkKlingCostCap(
  projectId: string,
  reader: KlingSpendReader,
  cap: KlingCostCap
): Promise<void> {
  const accumulated = await reader.getAccumulatedSpendUsd(projectId);
  if (accumulated >= cap.capUsd) {
    throw new KlingCostCapExceededError(projectId, cap.capUsd, accumulated);
  }
  const warnThreshold = cap.capUsd * cap.warnFraction;
  if (accumulated >= warnThreshold) {
    console.warn(
      `[video-kling] project ${projectId} at $${accumulated.toFixed(2)} (${Math.round(
        (accumulated / cap.capUsd) * 100
      )}% of $${cap.capUsd.toFixed(2)} cap)`
    );
  }
}
