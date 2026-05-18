"use client";
/**
 * BuildProgressBanner — top-of-canvas progress strip that's visible across
 * mode switches (designing → preview) so the user gets unmissable feedback
 * once "Use this" lands.
 *
 * Reads the SSE event stream directly via Plan E.0's EventSourceProvider and
 * derives a single human-readable phase string from the most recent event.
 *
 * Visible when one of these is true:
 *   - canvas.option.selected has fired (user picked a direction)
 *   - asset.gen.started ... asset.gen.completed (hero image being generated)
 *   - role.started with roleId=developer (developer writing code)
 *   - sandbox.apply.started (writing to sandbox)
 *
 * Hides when ritual.completed or ritual.transitioned ("transitioned" payload
 * carries the engine's terminal state) lands — or when no in-flight ritual
 * event has been seen at all (cold page load with no ritual yet).
 */
import * as React from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";

interface BannerPhase {
  label: string;
  detail: string;
}

const PHASES: Record<string, BannerPhase> = {
  "canvas.option.selected": { label: "Generating", detail: "Direction selected — sourcing hero imagery next." },
  "asset.gen.started":      { label: "Generating", detail: "Generating hero image (gpt-image-1)…" },
  "asset.gen.completed":    { label: "Generating", detail: "Hero image ready — developer writing code…" },
  "asset.gen.failed":       { label: "Generating", detail: "Hero image step failed (using fallback) — developer writing code…" },
  "sandbox.apply.started":  { label: "Deploying",  detail: "Writing diff to your live preview sandbox…" }
};

const HIDE_ON: ReadonlySet<string> = new Set([
  "sandbox.apply.completed",
  "sandbox.apply.failed",
  "ritual.completed",
  "ritual.escalated",
  "ritual.escalation_requested"
]);

export function BuildProgressBanner() {
  const { events } = useEventStream();

  const phase = React.useMemo<BannerPhase | null>(() => {
    // Walk newest → oldest. The first event we recognize wins. If we hit a
    // terminal event before any progress event, hide the banner.
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (!e) continue;
      if (HIDE_ON.has(e.type as string)) return null;
      const p = PHASES[e.type as string];
      if (p) return p;
      // role.started/role.completed are role-agnostic; only surface a phase
      // when payload.role === "developer".
      if (e.type === "role.started") {
        const role = (e.payload as { role?: unknown }).role;
        if (role === "developer") return { label: "Generating", detail: "Developer writing code (Sonnet + reviewer)…" };
      }
    }
    return null;
  }, [events]);

  if (phase === null) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="build-progress-banner"
      className="flex items-center gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900"
    >
      <div
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-300 border-t-emerald-700"
      />
      <span className="font-semibold">{phase.label}</span>
      <span className="text-emerald-800">{phase.detail}</span>
    </div>
  );
}
