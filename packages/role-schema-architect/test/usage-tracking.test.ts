import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SchemaArchitectRole } from "../src/role.js";
import type { LLMProvider } from "@atlas/llm-provider";

/**
 * Plan G.4 Task 3 — SchemaArchitectRole records token usage tagged with
 * roleId="schema-architect" after every LLM call.
 */

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

describe("SchemaArchitectRole — usageTracker.record (Plan G.4 Task 3)", () => {
  afterEach(() => {
    delete process.env.ATLAS_FF_SCHEMA_ARCHITECT_3PASS;
  });

  it("records single draft-pass usage tagged roleId='schema-architect' (single-pass branch)", async () => {
    delete process.env.ATLAS_FF_SCHEMA_ARCHITECT_3PASS;
    const llm = {
      name: "anthropic",
      completeWithToolUse: vi.fn().mockResolvedValue({
        toolName: "emit_schema_proposal",
        input: validProposal(),
        usage: { inputTokens: 175, outputTokens: 50 }
      })
    } as unknown as LLMProvider;
    const record = vi.fn();
    const role = new SchemaArchitectRole({ llm });

    await role.run({ ...backendInvocation, usageTracker: { record } });
    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(
      "anthropic",
      expect.any(String),
      { inputTokens: 175, outputTokens: 50 },
      { roleId: "schema-architect" }
    );
  });

  it("records three usage events (draft + critique + revise) when 3-pass flag is on", async () => {
    process.env.ATLAS_FF_SCHEMA_ARCHITECT_3PASS = "true";
    const llm = {
      name: "anthropic",
      completeWithToolUse: vi
        .fn()
        .mockResolvedValueOnce({ toolName: "emit_schema_proposal", input: validProposal(), usage: { inputTokens: 10, outputTokens: 1 } })
        .mockResolvedValueOnce({ toolName: "emit_critique", input: { distinctness: 8, briefAlignment: 9, issues: [] }, usage: { inputTokens: 20, outputTokens: 2 } })
        .mockResolvedValueOnce({ toolName: "emit_revised_schema_proposal", input: validProposal(), usage: { inputTokens: 30, outputTokens: 3 } })
    } as unknown as LLMProvider;
    const record = vi.fn();
    const role = new SchemaArchitectRole({ llm });

    await role.run({ ...backendInvocation, usageTracker: { record } });
    expect(record).toHaveBeenCalledTimes(3);
    for (const call of record.mock.calls) {
      const opts = call[3] as { roleId?: string } | undefined;
      expect(opts?.roleId).toBe("schema-architect");
    }
  });
});
