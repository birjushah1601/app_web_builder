"use client";

import { useMemo } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";

interface Props {
  /** Injected for tests so duration is deterministic. Real usage uses Date.now. */
  nowMs?: () => number;
}

interface Derived {
  text: string;
  tone: "slate" | "amber" | "emerald" | "red";
  pulse: boolean;
}

function deriveStripState(
  events: Array<{ type: string; payload: Record<string, unknown>; ts: number }>,
  status: string,
  nowMs: number
): Derived {
  if (status === "error") {
    return { text: "Disconnected · retrying", tone: "amber", pulse: false };
  }
  if (events.length === 0) {
    return { text: "Idle · ready", tone: "slate", pulse: false };
  }

  let activeRole: string | null = null;
  let activeStartedAt: number | null = null;
  let autoFixCount = 0;
  let escalated: { reason?: string } | null = null;
  let lastTs = events[0]!.ts;

  for (const e of events) {
    lastTs = e.ts;
    switch (e.type) {
      case "ritual.started":
        activeRole = null; activeStartedAt = null; autoFixCount = 0; escalated = null;
        break;
      case "auto_fix.attempted":
        autoFixCount++;
        break;
      case "role.started": {
        const role = (e.payload.roleId ?? e.payload.role) as string | undefined;
        if (role) { activeRole = role; activeStartedAt = e.ts; }
        break;
      }
      case "role.completed":
      case "role.failed":
        activeRole = null; activeStartedAt = null;
        break;
      case "ritual.escalation_requested":
      case "ritual.escalated":
        escalated = { reason: e.payload.reason as string | undefined };
        activeRole = null;
        break;
      case "ritual.completed":
        activeRole = null; activeStartedAt = null;
        break;
    }
  }

  if (escalated) {
    const reason = escalated.reason ?? "ritual";
    return { text: `Escalated · ${reason} · click to expand`, tone: "red", pulse: false };
  }
  if (activeRole && activeStartedAt !== null) {
    const seconds = Math.max(0, Math.round((nowMs - activeStartedAt) / 1000));
    const prefix = autoFixCount > 0 ? `Auto-fix #${autoFixCount} · ` : "";
    return { text: `${prefix}${activeRole} · ${seconds}s`, tone: "amber", pulse: true };
  }
  // Last event was terminal (completed/failed), no active phase.
  const sinceMs = Math.max(0, Math.round((nowMs - lastTs) / 1000));
  return { text: `Idle · last activity ${sinceMs}s ago`, tone: "slate", pulse: false };
}

const TONE_CLASS: Record<Derived["tone"], string> = {
  slate: "text-slate-500 border-slate-200 bg-slate-50",
  amber: "text-amber-700 border-amber-200 bg-amber-50",
  emerald: "text-emerald-700 border-emerald-200 bg-emerald-50",
  red: "text-red-700 border-red-300 bg-red-50"
};

export function RitualStatusStrip({ nowMs }: Props = {}) {
  const { events, status } = useEventStream();
  const derived = useMemo(
    () => deriveStripState(events, status, (nowMs ?? Date.now)()),
    [events, status, nowMs]
  );
  return (
    <div
      data-testid="ritual-status-strip"
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 border-b px-4 h-8 text-xs font-mono ${TONE_CLASS[derived.tone]}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-full bg-current ${derived.pulse ? "animate-pulse" : ""}`}
      />
      <span className="truncate">{derived.text}</span>
    </div>
  );
}
