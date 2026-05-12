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

import { Fragment } from "react";
import { useTimelineState, type Phase } from "@/lib/ritual/useTimelineState";
import { RitualTimelineRow } from "@/components/ritual/RitualTimelineRow";
import { EscalationCallout } from "@/components/EscalationCallout";
import { EscalationBanner } from "@/components/ritual/EscalationBanner";
import { useTimelineCollapse } from "@/lib/ritual/use-timeline-collapse";
import { useResearcherBrief } from "@/lib/research/useResearcherBrief";
import { ResearcherBriefCard } from "@/components/research/ResearcherBriefCard";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import { CritiqueDisclosure, type CritiqueFinding } from "@/components/ritual/CritiqueDisclosure";

const ROW_TITLE: Record<Phase, string> = {
  architect:     "Architect planning",
  developer:     "Developer writing",
  sandbox:       "Applying to sandbox",
  security:      "Security gate",
  accessibility: "Accessibility gate"
};

const ROW_ORDER: Phase[] = ["architect", "developer", "sandbox", "security", "accessibility"];

export function RitualTimeline({
  projectId,
  editablePlanEnabled = false
}: {
  projectId: string;
  /** Plan UXO Task 7: server-evaluated editable-plan flag forwarded by
   *  the layout. When on AND a designer.critique.completed event has
   *  landed for the active ritual, render <CritiqueDisclosure /> between
   *  the architect row and the developer row. */
  editablePlanEnabled?: boolean;
}) {
  const state = useTimelineState();
  const { open, setOpen } = useTimelineCollapse(projectId);
  const { briefByRitualId } = useResearcherBrief();
  // Plan S.2: derive the active ritualId from the most recent event in
  // the stream. useTimelineState's reducer resets on `ritual.started`, so
  // the most recent event's ritualId IS the ritual whose rows are
  // currently rendered. Falls back to undefined when no events have
  // arrived (initial mount, flag-OFF, etc.) — the brief card then hides
  // because briefByRitualId[undefined] is undefined.
  const { events } = useEventStream();
  const activeRitualId = events.length > 0 ? events[events.length - 1]?.ritualId : undefined;
  const activeBrief = activeRitualId ? briefByRitualId[activeRitualId] : undefined;
  // Plan UXO Task 7 — pluck the most recent designer.critique.completed for
  // the active ritual. Empty array when the event hasn't arrived (or has
  // arrived for a stale ritual the timeline reducer has already reset).
  const critiqueFindings: ReadonlyArray<CritiqueFinding> = (() => {
    if (!editablePlanEnabled || !activeRitualId) return [];
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (!e) continue;
      if (e.ritualId !== activeRitualId) continue;
      if (e.type !== "designer.critique.completed") continue;
      // Broker passes the conductor payload through unchanged. The
      // designer role wraps findings under `critique.findings`; tolerate
      // the older `findings` shape too for forward compat.
      const p = e.payload as {
        critique?: { findings?: ReadonlyArray<CritiqueFinding> };
        findings?: ReadonlyArray<CritiqueFinding>;
      };
      const arr = p?.critique?.findings ?? p?.findings;
      if (Array.isArray(arr)) return arr;
      return [];
    }
    return [];
  })();
  // Plan PFP gap-fix: echo the user's prompt as the first line of the live
  // panel. Without this the chat looks "blank" because the prompt was
  // submitted at /projects/new and the canvas page only renders the
  // ritual's downstream output.
  const userTurn = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e?.type === "ritual.started") {
        const payload = e.payload as { intent?: string; userTurn?: string } | undefined;
        // Engine emits the prompt as `intent`; some refine paths use `userTurn`.
        // Read both for forward compat.
        const turn = payload?.intent ?? payload?.userTurn;
        if (typeof turn === "string" && turn.length > 0) return turn;
      }
    }
    return undefined;
  })();

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

        {userTurn && (
          <div
            data-testid="user-turn-echo"
            className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-700"
          >
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">You</span>
            <p className="mt-1 whitespace-pre-wrap">{userTurn}</p>
          </div>
        )}

        {visibleRows.map((phase) => (
          <Fragment key={phase}>
            <RitualTimelineRow row={state.rows[phase]} title={ROW_TITLE[phase]} />
            {/* Plan S.2 — insert the researcher brief immediately after the
             *  architect row (before developer) when a brief exists for the
             *  active ritual. Slotted via the row map (vs. a separate JSX
             *  block) so the card appears in the correct sequential position
             *  even when developer / sandbox / gate rows are pending. */}
            {phase === "architect" && activeBrief && activeRitualId && (
              <ResearcherBriefCard brief={activeBrief} ritualId={activeRitualId} />
            )}
            {/* Plan UXO Task 7 — collapsed designer-critique disclosure,
             *  slotted between the architect row and the developer row
             *  (Atlas does not surface a dedicated "designer" row in the
             *  rail; the designer role's output lives inline as part of
             *  the architect-to-developer handoff). */}
            {phase === "architect" && editablePlanEnabled && critiqueFindings.length > 0 && (
              <CritiqueDisclosure findings={critiqueFindings} />
            )}
          </Fragment>
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
            {/* Plan #14 — surface the conductor's failure context (failed
                role, attempts, finalError) so the chat doesn't go silent
                on escalation. Renders only when the reducer captured
                escalation details (i.e. the broker forwarded a
                ritual.escalated event with payload, not the older
                ritual.escalation_requested fallback). */}
            {state.escalation && (
              <EscalationBanner details={state.escalation} />
            )}
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
