"use client";

import * as React from "react";
import { SchemaCanvas } from "@/components/canvas/renderers/SchemaCanvas";
import { EventStreamCtxForTesting } from "@/lib/events/EventSourceProvider";
import { cannedSchemaProposal } from "@/e2e/visual/fixtures/canned-schema-proposal";
import type { PersonaTier } from "@atlas/ritual-engine";

const CANNED_CONTEXT = {
  events: [
    {
      type: "schema_architect.proposal.emitted",
      payload: { proposal: cannedSchemaProposal }
    }
  ],
  status: "disabled" as const,
  lastEventId: null
};

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
