import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("SchemaCanvas — expand pane on select", () => {
  const proposalWithRestOps = () => ({
    recommended: {
      id: "rest-crud", name: "RESTful CRUD",
      shortDescription: "x", technicalDescription: "y",
      contract: {
        style: "rest" as const,
        operations: [
          { method: "GET", path: "/users", summary: "List users", statusCodes: [200] },
          { method: "POST", path: "/users", summary: "Create user", statusCodes: [201] }
        ]
      },
      dataModel: {
        entities: [{
          name: "user",
          description: "User account",
          fields: [
            { name: "id", type: "uuid", nullable: false },
            { name: "email", type: "citext", nullable: false }
          ],
          primaryKey: { columns: ["id"], strategy: "uuid" as const },
          indexes: [],
          constraints: [],
          rls: { enabled: false, policies: [] },
          audit: { createdAt: true, updatedAt: true },
          migrationHints: []
        }]
      }
    },
    alternates: [
      { id: "alt1", name: "Alt1", shortDescription: "x", technicalDescription: "y",
        contract: { style: "rest" as const, operations: [] },
        dataModel: { entities: [] } },
      { id: "alt2", name: "Alt2", shortDescription: "x", technicalDescription: "y",
        contract: { style: "rest" as const, operations: [] },
        dataModel: { entities: [] } }
    ],
    reasoning: "x"
  });

  const proposalWithGraphqlOps = () => {
    const p = proposalWithRestOps();
    p.recommended.contract = {
      style: "graphql" as const,
      operations: [
        { kind: "query", name: "listUsers", summary: "List users", args: [], returnType: "[User]" }
      ]
    } as never;
    return p;
  };

  beforeEach(() => {
    vi.resetModules();
  });

  it("shows Contract + Data Model headers when a card is selected", async () => {
    vi.doMock("@/lib/events/EventSourceProvider", () => ({
      useEventStream: () => ({
        events: [{ type: "schema_architect.proposal.emitted", payload: { proposal: proposalWithRestOps() } }],
        status: "open",
        lastEventId: "x"
      })
    }));
    const { SchemaCanvas } = await import("@/components/canvas/renderers/SchemaCanvas");
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="diego" />);
    const card = screen.getByText("RESTful CRUD").closest('[data-testid="schema-direction-card"]')!;
    await userEvent.click(card);
    expect(screen.getByText(/contract/i)).toBeInTheDocument();
    expect(screen.getByText(/data model/i)).toBeInTheDocument();
  });

  it("renders REST operations as METHOD path lines", async () => {
    vi.doMock("@/lib/events/EventSourceProvider", () => ({
      useEventStream: () => ({
        events: [{ type: "schema_architect.proposal.emitted", payload: { proposal: proposalWithRestOps() } }],
        status: "open",
        lastEventId: "x"
      })
    }));
    const { SchemaCanvas } = await import("@/components/canvas/renderers/SchemaCanvas");
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="diego" />);
    const card = screen.getByText("RESTful CRUD").closest('[data-testid="schema-direction-card"]')!;
    await userEvent.click(card);
    // GET appears in a span; /users sits as a text node next to it inside <li>.
    // Multiple REST ops (GET /users + POST /users) match the regex, so use
    // getAllByText and assert at least one match.
    expect(screen.getAllByText("GET").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/\/users/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders GraphQL operations with kind + name", async () => {
    vi.doMock("@/lib/events/EventSourceProvider", () => ({
      useEventStream: () => ({
        events: [{ type: "schema_architect.proposal.emitted", payload: { proposal: proposalWithGraphqlOps() } }],
        status: "open",
        lastEventId: "x"
      })
    }));
    const { SchemaCanvas } = await import("@/components/canvas/renderers/SchemaCanvas");
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="diego" />);
    const card = screen.getByText("RESTful CRUD").closest('[data-testid="schema-direction-card"]')!;
    await userEvent.click(card);
    expect(screen.getByText(/query/)).toBeInTheDocument();
    // listUsers sits in the <li>'s text alongside ":" and the returnType, so
    // exact-string match misses; regex finds it via the parent textContent.
    expect(screen.getByText(/listUsers/)).toBeInTheDocument();
  });

  it("renders entity field rows with type", async () => {
    vi.doMock("@/lib/events/EventSourceProvider", () => ({
      useEventStream: () => ({
        events: [{ type: "schema_architect.proposal.emitted", payload: { proposal: proposalWithRestOps() } }],
        status: "open",
        lastEventId: "x"
      })
    }));
    const { SchemaCanvas } = await import("@/components/canvas/renderers/SchemaCanvas");
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="diego" />);
    const card = screen.getByText("RESTful CRUD").closest('[data-testid="schema-direction-card"]')!;
    await userEvent.click(card);
    // The <li> renders "email " text node + <span>citext</span> + maybe
    // " NOT NULL" span — so "email" is a partial match against the <li>;
    // "citext" matches the inner span exactly.
    expect(screen.getByText(/email/)).toBeInTheDocument();
    expect(screen.getByText("citext")).toBeInTheDocument();
  });
});

describe("SchemaCanvas — Use this direction", () => {
  const proposal = () => ({
    recommended: {
      id: "rest-crud", name: "RESTful CRUD",
      shortDescription: "x", technicalDescription: "y",
      contract: { style: "rest" as const, operations: [] },
      dataModel: { entities: [] }
    },
    alternates: [
      { id: "alt1", name: "Alt1", shortDescription: "x", technicalDescription: "y",
        contract: { style: "rest" as const, operations: [] },
        dataModel: { entities: [] } },
      { id: "alt2", name: "Alt2", shortDescription: "x", technicalDescription: "y",
        contract: { style: "rest" as const, operations: [] },
        dataModel: { entities: [] } }
    ],
    reasoning: "x"
  });

  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/events/EventSourceProvider", () => ({
      useEventStream: () => ({
        events: [{ type: "schema_architect.proposal.emitted", payload: { proposal: proposal() } }],
        status: "open",
        lastEventId: "x"
      })
    }));
  });

  it("calls selectSchemaDirection with ritualId + directionId on click", async () => {
    const selectSpy = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/actions/selectSchemaDirection", () => ({ selectSchemaDirection: selectSpy }));
    const { SchemaCanvas } = await import("@/components/canvas/renderers/SchemaCanvas");
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="ama" />);
    await userEvent.click(screen.getByText("RESTful CRUD").closest('[data-testid="schema-direction-card"]')!);
    await userEvent.click(screen.getByRole("button", { name: /use this direction/i }));
    // The action now also receives the full direction (post-PR-#12). Use a
    // matcher so the test verifies the call shape without depending on the
    // exact direction payload structure.
    expect(selectSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ritualId: "r1", directionId: "rest-crud" })
    );
  });

  it("shows an error toast when selectSchemaDirection throws", async () => {
    const selectSpy = vi.fn().mockRejectedValue(new Error("unauthorized"));
    vi.doMock("@/lib/actions/selectSchemaDirection", () => ({ selectSchemaDirection: selectSpy }));
    const { SchemaCanvas } = await import("@/components/canvas/renderers/SchemaCanvas");
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="ama" />);
    await userEvent.click(screen.getByText("RESTful CRUD").closest('[data-testid="schema-direction-card"]')!);
    await userEvent.click(screen.getByRole("button", { name: /use this direction/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("renders 'Developer building...' after a successful select", async () => {
    vi.doMock("@/lib/actions/selectSchemaDirection", () => ({ selectSchemaDirection: vi.fn().mockResolvedValue(undefined) }));
    const { SchemaCanvas } = await import("@/components/canvas/renderers/SchemaCanvas");
    render(<SchemaCanvas projectId="p1" ritualId="r1" persona="ama" />);
    await userEvent.click(screen.getByText("RESTful CRUD").closest('[data-testid="schema-direction-card"]')!);
    await userEvent.click(screen.getByRole("button", { name: /use this direction/i }));
    expect(await screen.findByText(/developer building/i)).toBeInTheDocument();
  });
});
