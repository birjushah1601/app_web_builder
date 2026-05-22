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
    designIntent: { category: "backend-rest-api" },
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
});
