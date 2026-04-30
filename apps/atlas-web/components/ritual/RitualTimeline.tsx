"use client";

/**
 * RitualTimeline — orchestrator that renders timeline rows for each phase
 * the engine has progressed (architect, developer, sandbox always; security
 * + accessibility only when their gates ran), plus the EscalationCallout
 * on escalation and a Plan P auto-fix indicator when the engine's auto-fix
 * loop is active.
 *
 * Subscribes to the ambient EventSourceProvider via the useTimelineState
 * hook AND uses Plan R's useTimelineCollapse (sessionStorage-backed,
 * auto-collapses on first sandbox.apply.completed). Requires `projectId`
 * so per-project collapse state stays distinct. Mount this component below
 * ANY EventSourceProvider — Plan G's RailShell mounts the rail-footer slot
 * which dynamic-imports this component.
 */

import { useTimelineState, type Phase } from "@/lib/ritual/useTimelineState";
import { RitualTimelineRow } from "@/components/ritual/RitualTimelineRow";
import { EscalationCallout } from "@/components/EscalationCallout";
import { useTimelineCollapse } from "@/lib/ritual/use-timeline-collapse";

const ROW_TITLE: Record<Phase, string> = {
  architect:     "Architect planning",
  developer:     "Developer writing",
  sandbox:       "Applying to sandbox",
  security:      "Security gate",
  accessibility: "Accessibility gate"
};

const ROW_ORDER: Phase[] = ["architect", "developer", "sandbox", "security", "accessibility"];

export function RitualTimeline({ projectId }: { projectId: string }) {
  const state = useTimelineState();
  const { open, setOpen } = useTimelineCollapse(projectId);

  // Plan P: only render Plan I gate rows when SOMETHING progressed them.
  // Pending gate rows are hidden so flag-OFF rituals look identical to
  // pre-Plan-P (architect → developer → sandbox).
  const visibleRows = ROW_ORDER.filter((phase) => {
    if (phase !== "security" && phase !== "accessibility") return true;
    return state.rows[phase].status !== "pending";
  });

  return (
    <section data-testid="ritual-timeline" className="rounded-md border border-slate-200 bg-white">
      <details
        data-testid="ritual-timeline-details"
        open={open}
      >
        <summary
          data-testid="ritual-timeline-summary"
          className="cursor-pointer select-none px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-500"
          // Both onClick (mouse) and onKeyDown (keyboard) call preventDefault
          // and route through setOpen so React fully owns the `open` attribute.
          // Without the keyboard handler, Space/Enter on the summary would
          // toggle natively but our state would not update — visible state
          // and React state would drift apart for keyboard-only users.
          onClick={(e) => {
            e.preventDefault();
            setOpen(!open);
          }}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              setOpen(!open);
            }
          }}
        >
          Live progress
        </summary>

        {visibleRows.map((phase) => (
          <RitualTimelineRow key={phase} row={state.rows[phase]} title={ROW_TITLE[phase]} />
        ))}

        {/* Plan P: auto-fix indicator. Renders inline (not as a row) because
         *  auto-fix is a meta-state — when triggered, the architect→developer
         *  →gates pipeline re-runs as a child ritual; the badge tells users
         *  the engine is in fix-attempt mode. Also surfaces budget-exhausted
         *  and refinement-failed terminal states. */}
        {(state.autoFixAttempts > 0 || state.autoFixExhausted || state.autoFixFailed) && (
          <div
            data-testid="auto-fix-indicator"
            className="border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            {state.autoFixExhausted
              ? `Auto-fix budget reached (${state.autoFixAttempts} attempts)`
              : state.autoFixFailed
                ? `Auto-fix failed: ${state.autoFixFailed}`
                : `Auto-fix #${state.autoFixAttempts} in progress…`}
          </div>
        )}

        {state.escalated && (
          <div className="border-t border-slate-200 p-2">
            {/* EscalationCallout requires gate + onAskReviewer; we pass the
                literal "ritual" gate id (the conductor doesn't surface a
                specific gate today) and a no-op handler — ask-reviewer
                routing is out of scope for plan E (spec §Non-Goals). */}
            <EscalationCallout gate="ritual" onAskReviewer={() => { /* plan-G v2 */ }} />
          </div>
        )}
      </details>
    </section>
  );
}
