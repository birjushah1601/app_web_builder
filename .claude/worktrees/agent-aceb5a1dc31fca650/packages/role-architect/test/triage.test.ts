import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { triage, ARCHITECT_TRIAGE_MODEL } from "../src/triage.js";

describe("triage (Pass 1 happy path)", () => {
  it("calls Anthropic with triage model, tool-use constrained to AmbiguityReport schema", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        {
          type: "tool_use",
          id: "tu_1",
          name: "emit_ambiguity_report",
          input: {
            passed: true,
            scope: "new-feature",
            questions: []
          }
        }
      ],
      model: ARCHITECT_TRIAGE_MODEL,
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 10 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const report = await triage({
      userTurn: "add forgot-password",
      graphSlice: { bytes: "{}", hash: "sha256:zero" },
      llm: provider
    });

    expect(report).toMatchObject({ passed: true, scope: "new-feature" });

    expect(sdkCreate).toHaveBeenCalledOnce();
    const call = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(call.model).toBe(ARCHITECT_TRIAGE_MODEL);
    expect(call.max_tokens).toBe(4096);
    expect(Array.isArray(call.tools)).toBe(true);
    const tools = call.tools as Array<{ name: string; input_schema: Record<string, unknown> }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("emit_ambiguity_report");
    expect(tools[0].input_schema.type).toBe("object");
  });

  it("respects an overridden triage model", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        { type: "tool_use", id: "tu", name: "emit_ambiguity_report", input: { passed: true, scope: "bug-fix", questions: [] } }
      ],
      model: "claude-custom-triage",
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 1 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    await triage({
      userTurn: "fix the login 500",
      graphSlice: { bytes: "{}", hash: "sha256:zero" },
      llm: provider,
      triageModel: "claude-custom-triage"
    });

    const call = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(call.model).toBe("claude-custom-triage");
  });
});
