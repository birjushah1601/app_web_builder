"use client";

/**
 * RitualTimeline — orchestrator that renders the three RitualTimelineRows
 * (Architect / Developer / Sandbox) plus the existing EscalationCallout
 * when state.escalated flips true.
 *
 * Reads no props; subscribes to the ambient EventSourceProvider via the
 * useTimelineState hook. Mount this component below ANY EventSourceProvider
 * — today the canvas page mounts both (gated on the live-events flag);
 * Plan G later moves the mount up into RailShell with no API change.
 */

import { useTimelineState, type Phase } from "@/lib/ritual/useTimelineState";
import { RitualTimelineRow } from "@/components/ritual/RitualTimelineRow";
import { EscalationCallout } from "@/components/EscalationCallout";

const ROW_TITLE: Record<Phase, string> = {
  architect: "Architect planning",
  developer: "Developer writing",
  sandbox:   "Applying to sandbox"
};

const ROW_ORDER: Phase[] = ["architect", "developer", "sandbox"];

export function RitualTimeline() {
  const state = useTimelineState();
  return (
    <section data-testid="ritual-timeline" className="rounded-md border border-slate-200 bg-white">
      {ROW_ORDER.map((phase) => (
        <RitualTimelineRow key={phase} row={state.rows[phase]} title={ROW_TITLE[phase]} />
      ))}
      {state.escalated && (
        <div className="border-t border-slate-200 p-2">
          {/* EscalationCallout requires gate + onAskReviewer; we pass the
              literal "ritual" gate id (the conductor doesn't surface a
              specific gate today) and a no-op handler — ask-reviewer
              routing is out of scope for plan E (spec §Non-Goals). */}
          <EscalationCallout gate="ritual" onAskReviewer={() => { /* plan-G v2 */ }} />
        </div>
      )}
    </section>
  );
}
