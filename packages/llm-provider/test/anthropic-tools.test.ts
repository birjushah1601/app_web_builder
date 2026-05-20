import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "../src/index.js";
import type { LLMMessage } from "../src/provider.js";

describe("AnthropicProvider.completeWithToolUse", () => {
  it("returns the tool_use input when the model uses a tool", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [
        { type: "tool_use", id: "tu_1", name: "emit_report", input: { passed: true, score: 42 } }
      ],
      model: "claude-haiku-4-5-20251001",
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const result = await provider.completeWithToolUse(
      [{ role: "user", content: "go" }] as LLMMessage[],
      {
        model: "claude-haiku-4-5-20251001",
        maxTokens: 4096,
        tools: [{ name: "emit_report", description: "x", input_schema: { type: "object", properties: {} } }],
        toolChoice: { type: "tool", name: "emit_report" }
      }
    );

    expect(result.toolName).toBe("emit_report");
    expect(result.input).toEqual({ passed: true, score: 42 });
    expect(sdkCreate).toHaveBeenCalledOnce();
    const body = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toEqual({ type: "tool", name: "emit_report" });
  });

  it("throws ToolUseMissingError when the model emits only text", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "text", text: "I refuse to use the tool" }],
      model: "claude-haiku-4-5-20251001",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    await expect(provider.completeWithToolUse(
      [{ role: "user", content: "go" }] as LLMMessage[],
      {
        model: "claude-haiku-4-5-20251001",
        maxTokens: 4096,
        tools: [{ name: "emit_report", description: "x", input_schema: { type: "object", properties: {} } }],
        toolChoice: { type: "tool", name: "emit_report" }
      }
    )).rejects.toThrow(/tool_use/);
  });
});
