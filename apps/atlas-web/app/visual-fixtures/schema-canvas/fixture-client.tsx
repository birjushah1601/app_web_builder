"use client";

import * as React from "react";
import { SchemaCanvas } from "@/components/canvas/renderers/SchemaCanvas";
import { EventStreamCtxForTesting } from "@/lib/events/EventSourceProvider";
import { cannedSchemaProposal } from "@/e2e/visual/fixtures/canned-schema-proposal";
import type { PersonaTier } from "@atlas/ritual-engine";

// Cast the canned context to the loose `unknown`-payload event shape the
// provider's value contract expects. The canned proposal has a strongly-
// typed structure that doesn't precisely match the runtime RitualEvent
// union (those payloads are `Record<string, unknown>` after the broker
// forwarding step), so we cross the boundary via `as unknown as`.
const CANNED_CONTEXT = {
  events: [
    {
      type: "schema_architect.proposal.emitted",
      payload: { proposal: cannedSchemaProposal } as unknown as Record<string, unknown>
    }
  ],
  status: "disabled" as const,
  lastEventId: null
} as unknown as React.ContextType<typeof EventStreamCtxForTesting>;

export function SchemaCanvasFixtureClient({ persona }: { persona: PersonaTier }) {
  return (
    <EventStreamCtxForTesting.Provider value={CANNED_CONTEXT}>
      <SchemaCanvas
        projectId="fixture-project"
        ritualId="fixture-ritual"
        persona={persona}
      />
    </EventStreamCtxForTesting.Provider>
  );
}
