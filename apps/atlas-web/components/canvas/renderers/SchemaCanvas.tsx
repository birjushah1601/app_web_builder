"use client";

import * as React from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import type { SchemaProposal, SchemaDirection } from "@atlas/role-schema-architect";

export interface SchemaCanvasProps {
  projectId: string;
  ritualId: string;
  persona: "ama" | "diego" | "priya";
}

export function SchemaCanvas({ projectId: _projectId, ritualId: _ritualId, persona: _persona }: SchemaCanvasProps) {
  const { events } = useEventStream();
  const proposal = React.useMemo(() => extractLatestProposal(events), [events]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  if (!proposal) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500" data-testid="schema-canvas">
        <p>Waiting for schema proposal…</p>
      </div>
    );
  }

  const cards: Array<{ direction: SchemaDirection; isRecommended: boolean }> = [
    { direction: proposal.recommended, isRecommended: true },
    { direction: proposal.alternates[0], isRecommended: false },
    { direction: proposal.alternates[1], isRecommended: false }
  ];

  return (
    <main className="p-6" data-testid="schema-canvas">
      <h2 className="mb-4 text-lg font-semibold">Schema directions</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {cards.map(({ direction, isRecommended }) => (
          <button
            key={direction.id}
            type="button"
            data-testid="schema-direction-card"
            onClick={() => setSelectedId(direction.id)}
            className={`rounded-lg border p-4 text-left transition ${
              selectedId === direction.id ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white"
            }`}
          >
            {isRecommended && (
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-600">Recommended</div>
            )}
            <div className="text-base font-semibold">{direction.name}</div>
            <div className="mt-1 text-sm text-slate-600">{direction.shortDescription}</div>
            <div className="mt-2 text-xs text-slate-500">
              {direction.contract.operations.length} operations · {direction.dataModel.entities.length} entities
            </div>
          </button>
        ))}
      </div>
      {selectedId && (
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-4" data-testid="schema-direction-detail">
          <p className="text-sm text-slate-500">Selected: {selectedId}. Detail pane lands in Task 19.</p>
        </div>
      )}
    </main>
  );
}

function extractLatestProposal(events: ReadonlyArray<{ type: string; payload: unknown }>): SchemaProposal | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e && e.type === "schema_architect.proposal.emitted") {
      const proposal = (e.payload as { proposal?: SchemaProposal }).proposal;
      if (proposal) return proposal;
    }
  }
  return null;
}
