import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const stubProposal = () => ({
  recommended: dir("rest-crud", "RESTful CRUD"),
  alternates: [dir("rpc", "RPC-style"), dir("event-sourced", "Event-sourced")],
  reasoning: "RESTful CRUD because the brief says admin-CRUD on resources."
});

function dir(id: string, name: string) {
  return {
    id,
    name,
    shortDescription: "x",
    technicalDescription: "y",
    contract: { style: "rest" as const, operations: [] },
    dataModel: { entities: [] }
  };
}

describe("SchemaCanvas — empty state", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/events/EventSourceProvider", () => ({
      useEventStream: () => ({ events: [], status: "open", lastEventId: null })
    }));
  });

  it("renders 'Waiting for schema proposal' before any event arrives", async () => {
    const { SchemaCanvas } = await import("@/components/canvas/renderers/SchemaCanvas");
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="ama" />);
    expect(screen.getByText(/waiting for schema proposal/i)).toBeInTheDocument();
  });
});

describe("SchemaCanvas — 3-card render", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/events/EventSourceProvider", () => ({
      useEventStream: () => ({
        events: [{ type: "schema_architect.proposal.emitted", payload: { proposal: stubProposal() } }],
        status: "open",
        lastEventId: "x"
      })
    }));
  });

  it("renders 3 cards (recommended + 2 alternates) with names", async () => {
    const { SchemaCanvas } = await import("@/components/canvas/renderers/SchemaCanvas");
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="ama" />);
    expect(screen.getByText("RESTful CRUD")).toBeInTheDocument();
    expect(screen.getByText("RPC-style")).toBeInTheDocument();
    expect(screen.getByText("Event-sourced")).toBeInTheDocument();
  });

  it("marks the recommended card with a 'Recommended' badge", async () => {
    const { SchemaCanvas } = await import("@/components/canvas/renderers/SchemaCanvas");
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="ama" />);
    const recommendedCard = screen.getByText("RESTful CRUD").closest('[data-testid="schema-direction-card"]');
    expect(recommendedCard?.textContent).toMatch(/Recommended/i);
  });
});
