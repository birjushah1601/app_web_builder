"use client";

/**
 * Plan #14 — Renders the conductor's escalation context inside the chat
 * ritual timeline so users don't experience a silent failure when a
 * role's retry budget is exhausted.
 *
 * Surfaces:
 *   - which role failed (failedRoleId)
 *   - how many attempts the conductor made (attempts)
 *   - the final error (finalError, truncated to 200 chars + expander)
 *   - a Retry button (currently a stub — see retryRitual.ts)
 *
 * Mounted by RitualTimeline alongside the existing EscalationCallout —
 * the two coexist so we don't lose the "ask a reviewer" affordance.
 */

import { useState, useTransition } from "react";
import { retryRitual } from "@/lib/actions/retryRitual";
import type { EscalationDetails } from "@/lib/ritual/timelineReducer";

interface Props {
  details: EscalationDetails;
}

const ERROR_TRUNCATE_AT = 200;

export function EscalationBanner({ details }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [retryStatus, setRetryStatus] = useState<"idle" | "ok" | "error">("idle");

  const finalError = details.finalError ?? "(no error message provided)";
  const isLongError = finalError.length > ERROR_TRUNCATE_AT;
  const visibleError = expanded || !isLongError
    ? finalError
    : `${finalError.slice(0, ERROR_TRUNCATE_AT)}…`;

  function onRetry() {
    if (!details.ritualId || isPending) return;
    startTransition(async () => {
      try {
        const result = await retryRitual({ ritualId: details.ritualId! });
        setRetryStatus(result.ok ? "ok" : "error");
      } catch (err) {
        console.error("[atlas-web] retryRitual failed:", err);
        setRetryStatus("error");
      }
    });
  }

  return (
    <div
      role="alert"
      data-testid="escalation-banner"
      className="bg-red-50 border border-red-200 text-red-900 rounded-md p-3 mt-2"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="font-medium">Ritual escalated — retries exhausted</span>
        {details.attempts !== undefined && (
          <span
            data-testid="escalation-attempts"
            className="text-xs font-mono text-red-700"
          >
            {details.attempts} attempt{details.attempts === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {details.failedRoleId && (
        <div className="text-xs text-red-800">
          Failed role: <span data-testid="escalation-role" className="font-mono font-medium">{details.failedRoleId}</span>
        </div>
      )}
      <div
        data-testid="escalation-error"
        className="mt-2 whitespace-pre-wrap break-words text-xs font-mono text-red-900"
      >
        {visibleError}
      </div>
      {isLongError && (
        <button
          type="button"
          data-testid="escalation-expand"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-xs font-medium text-red-700 underline hover:text-red-900"
        >
          {expanded ? "Hide full error" : "Show full error"}
        </button>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          data-testid="escalation-retry"
          onClick={onRetry}
          disabled={isPending || !details.ritualId}
          className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs font-medium text-red-900 hover:bg-red-100 disabled:opacity-50"
        >
          {isPending ? "Retrying…" : "Retry"}
        </button>
        {retryStatus === "ok" && (
          <span data-testid="escalation-retry-ack" className="text-xs text-red-700">
            Retry queued.
          </span>
        )}
        {retryStatus === "error" && (
          <span data-testid="escalation-retry-error" className="text-xs text-red-700">
            Retry failed — see console.
          </span>
        )}
      </div>
    </div>
  );
}
