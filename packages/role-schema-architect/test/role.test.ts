import { describe, it, expect, vi } from "vitest";
import { SchemaArchitectRole } from "../src/role.js";
import type { RoleInvocation } from "@atlas/conductor";
import type { LLMProvider } from "@atlas/llm-provider";

const fakeLLM = (input: unknown): LLMProvider =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_schema_proposal", input })
  } as unknown as LLMProvider);

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
    reasoning: "RESTful CRUD because the brief describes admin-CRUD on resources."
  };
};

const backendInvocation: RoleInvocation = {
  ritualId: "r1",
  intent: "test",
  userTurn: "build me a backend",
  graphSlice: { bytes: "{}", hash: "h" },
  priorArtifact: {
    designIntent: { category: "backend-rest-api" },
    architectArtifact: { artifactKind: "backend-rest-api" }
  }
} as never;

describe("SchemaArchitectRole", () => {
  it("has id 'schema-architect'", () => {
    const role = new SchemaArchitectRole({ llm: fakeLLM(validProposal()) });
    expect(role.id).toBe("schema-architect");
  });

  it("emits started + emitted + completed on green", async () => {
    const role = new SchemaArchitectRole({ llm: fakeLLM(validProposal()) });
    const out = await role.run(backendInvocation);
    const types = out.events.map((e) => e.eventType);
    expect(types).toContain("schema_architect.proposal.started");
    expect(types).toContain("schema_architect.proposal.emitted");
    expect(types).toContain("schema_architect.proposal.completed");
  });

  it("skips with reason when no designIntent in priorArtifact", async () => {
    const role = new SchemaArchitectRole({ llm: fakeLLM(validProposal()) });
    const out = await role.run({ ...backendInvocation, priorArtifact: {} } as never);
    expect(out.events.some((e) => e.eventType === "schema_architect.proposal.skipped")).toBe(true);
    expect(out.events.some((e) => e.eventType === "schema_architect.proposal.emitted")).toBe(false);
  });

  it("throws SchemaArchitectFailedError with reason=llm-error on LLM failure", async () => {
    const llm = {
      completeWithToolUse: vi.fn().mockRejectedValue(new Error("503"))
    } as unknown as LLMProvider;
    const role = new SchemaArchitectRole({ llm });
    await expect(role.run(backendInvocation)).rejects.toThrow(/llm-error/);
  });

  it("rejects on bad proposal payload (schema-mismatch or related)", async () => {
    const role = new SchemaArchitectRole({ llm: fakeLLM({ recommended: { id: "rec" } /* bad shape */ }) });
    await expect(role.run(backendInvocation)).rejects.toThrow(/schema-mismatch|broken-reference|duplicate-name/);
  });

  it("does NOT call 3-pass when ATLAS_FF_SCHEMA_ARCHITECT_3PASS is unset/false", async () => {
    const llm = fakeLLM(validProposal());
    const role = new SchemaArchitectRole({ llm });
    await role.run(backendInvocation);
    expect((llm as unknown as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse).toHaveBeenCalledTimes(1);
  });
});
