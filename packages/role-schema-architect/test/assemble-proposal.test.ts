import { describe, it, expect, vi } from "vitest";
import { assembleProposal, DRAFT_SYSTEM_PROMPT, PROPOSAL_TOOL_SCHEMA } from "../src/assemble-proposal.js";
import type { LLMProvider } from "@atlas/llm-provider";

const fakeLLM = (input: unknown): LLMProvider =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_schema_proposal", input })
  } as unknown as LLMProvider);

const dir = (id: string) => ({
  id,
  name: id,
  shortDescription: "x",
  technicalDescription: "y",
  contract: { style: "rest", operations: [] },
  dataModel: {
    entities: [
      {
        name: "user",
        description: "User account",
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

const validProposalInput = () => ({
  recommended: dir("rest-crud"),
  alternates: [dir("rpc"), dir("event-sourced")],
  reasoning: "RESTful CRUD because the brief describes admin-CRUD operations on resources."
});

describe("DRAFT_SYSTEM_PROMPT", () => {
  it("includes the 10 hard rules markers", () => {
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/primary key/i);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/onDelete/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/timestamptz/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/tenant_id/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/CHECK.*IN/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/architecturally distinct/i);
  });
});

describe("PROPOSAL_TOOL_SCHEMA", () => {
  it("declares emit_schema_proposal with required recommended/alternates/reasoning", () => {
    expect(PROPOSAL_TOOL_SCHEMA.type).toBe("object");
    expect(PROPOSAL_TOOL_SCHEMA.required).toEqual(["recommended", "alternates", "reasoning"]);
  });
});

describe("assembleProposal", () => {
  it("calls completeWithToolUse and returns a parsed proposal", async () => {
    const llm = fakeLLM(validProposalInput());
    const result = await assembleProposal({
      llm,
      designIntent: { category: "saas-app" } as never,
      brief: null,
      architectArtifact: { artifactKind: "backend-rest-api" }
    });
    expect(result.recommended.id).toBe("rest-crud");
    expect(result.alternates.length).toBe(2);
  });

  it("throws SchemaArchitectFailedError with reason=llm-error on LLM throw", async () => {
    const llm = {
      completeWithToolUse: vi.fn().mockRejectedValue(new Error("network down"))
    } as unknown as LLMProvider;
    await expect(
      assembleProposal({ llm, designIntent: { category: "saas-app" } as never, brief: null, architectArtifact: {} })
    ).rejects.toThrow(/llm-error/);
  });

  it("throws SchemaArchitectFailedError with reason=schema-mismatch on bad payload", async () => {
    const llm = fakeLLM({ recommended: { id: "rec" } /* missing required fields */ });
    await expect(
      assembleProposal({ llm, designIntent: { category: "saas-app" } as never, brief: null, architectArtifact: {} })
    ).rejects.toThrow(/schema-mismatch/);
  });

  it("threads the architect artifact + brief into the user turn", async () => {
    const llm = fakeLLM(validProposalInput());
    await assembleProposal({
      llm,
      designIntent: { category: "saas-app" } as never,
      brief: { references: ["Stripe API"] } as never,
      architectArtifact: { artifactKind: "backend-rest-api", focus: "billing" }
    });
    const call = (llm as unknown as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = call[0] as Array<{ role: string; content: string }>;
    const userText = messages.find((m) => m && m.role === "user")?.content ?? "";
    expect(userText).toMatch(/Stripe API|billing|saas-app/);
  });
});
