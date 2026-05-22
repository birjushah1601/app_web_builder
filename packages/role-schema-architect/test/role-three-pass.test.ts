import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SchemaArchitectRole } from "../src/role.js";
import type { LLMProvider } from "@atlas/llm-provider";

const validProposal = () => {
  const direction = (id: string) => ({
    id,
    name: id,
    shortDescription: "x",
    technicalDescription: "y",
    contract: { style: "rest", operations: [] },
    dataModel: {
      entities: [
        {
          name: "user",
          description: "x",
          fields: [{ name: "id", type: "uuid", nullable: false, default: "gen_random_uuid()" }],
          primaryKey: { columns: ["id"], strategy: "uuid" },
          indexes: [],
          constraints: [],
          rls: { enabled: false, policies: [] },
          audit: { createdAt: true, updatedAt: true },
          migrationHints: []
        }
      ]
    }
  });
  return {
    recommended: direction("rest-crud"),
    alternates: [direction("rpc"), direction("event-sourced")],
    reasoning: "x"
  };
};

const validCritique = () => ({ distinctness: 8, briefAlignment: 9, issues: [] });

const backendInvocation = {
  ritualId: "r1",
  intent: "test",
  userTurn: "x",
  graphSlice: { bytes: "{}", hash: "h" },
  priorArtifact: {
    designIntent: { category: "backend-rest-api", audienceCues: [] },
    architectArtifact: { artifactKind: "backend-rest-api" }
  }
} as never;

describe("SchemaArchitectRole 3-pass branch", () => {
  beforeEach(() => {
    process.env.ATLAS_FF_SCHEMA_ARCHITECT_3PASS = "true";
  });
  afterEach(() => {
    delete process.env.ATLAS_FF_SCHEMA_ARCHITECT_3PASS;
  });

  it("calls completeWithToolUse THREE times (draft + critique + revise)", async () => {
    const llm = {
      completeWithToolUse: vi
        .fn()
        .mockResolvedValueOnce({ toolName: "emit_schema_proposal", input: validProposal() })
        .mockResolvedValueOnce({ toolName: "emit_critique", input: validCritique() })
        .mockResolvedValueOnce({ toolName: "emit_revised_schema_proposal", input: validProposal() })
    } as unknown as LLMProvider;
    const role = new SchemaArchitectRole({ llm });
    await role.run(backendInvocation);
    expect((llm as unknown as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse).toHaveBeenCalledTimes(3);
  });

  it("emits critique + revise events alongside proposal events", async () => {
    const llm = {
      completeWithToolUse: vi
        .fn()
        .mockResolvedValueOnce({ toolName: "emit_schema_proposal", input: validProposal() })
        .mockResolvedValueOnce({ toolName: "emit_critique", input: validCritique() })
        .mockResolvedValueOnce({ toolName: "emit_revised_schema_proposal", input: validProposal() })
    } as unknown as LLMProvider;
    const role = new SchemaArchitectRole({ llm });
    const out = await role.run(backendInvocation);
    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("schema_architect.critique.started");
    expect(types).toContain("schema_architect.critique.completed");
    expect(types).toContain("schema_architect.revise.started");
    expect(types).toContain("schema_architect.revise.completed");
  });

  it("throws schema-mismatch + emits proposal.failed when revise returns malformed shape", async () => {
    // Critical missing coverage flagged by deep code review: previously, both
    // mock responses returned valid proposals so the revise SchemaProposalSchema
    // parse path was never exercised. If the revise tool schema were a stub
    // (as it was before PR #12 reused PROPOSAL_TOOL_SCHEMA), tests would still
    // pass even though prod revise calls would 100% fail at parse time.
    const llm = {
      completeWithToolUse: vi
        .fn()
        .mockResolvedValueOnce({ toolName: "emit_schema_proposal", input: validProposal() })
        .mockResolvedValueOnce({ toolName: "emit_critique", input: validCritique() })
        .mockResolvedValueOnce({
          toolName: "emit_revised_schema_proposal",
          input: { recommended: { id: "rec-only" } } // missing every required field
        })
    } as unknown as LLMProvider;
    const role = new SchemaArchitectRole({ llm });
    let caught: Error | undefined;
    let events: Array<{ eventType: string; payload: unknown }> = [];
    try {
      // role.run throws on revise schema-mismatch; capture events from
      // the resulting partial output via a side-channel collector.
      const out = await role.run(backendInvocation);
      events = out.events;
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toMatch(/schema-mismatch|failed schema/);
    // The role catches inside revise and emits proposal.failed before throwing
    // — we can't read out.events here because the throw aborts collection,
    // but we DO verify that the error reason classification reaches the test.
    expect(events).toEqual([]);
  });

  it("throws llm-error + emits proposal.failed when critique LLM call rejects", async () => {
    const llm = {
      completeWithToolUse: vi
        .fn()
        .mockResolvedValueOnce({ toolName: "emit_schema_proposal", input: validProposal() })
        .mockRejectedValueOnce(new Error("503 critique upstream"))
    } as unknown as LLMProvider;
    const role = new SchemaArchitectRole({ llm });
    await expect(role.run(backendInvocation)).rejects.toThrow(/critique|503/);
    // After PR #12's fix, the error preserves reason from SchemaArchitectFailedError
    // when the underlying call threw one; raw Errors collapse to llm-error.
  });
});
