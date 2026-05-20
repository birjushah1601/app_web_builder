import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider } from "../src/anthropic.js";
import { createProviderMetrics } from "../src/observability.js";
import type { LLMMessage } from "../src/provider.js";

describe("AnthropicProvider.complete", () => {
  it("sends system + messages separately and preserves cache_control", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "text", text: "hello back" }],
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 50 }
    }));
    const sdk = { messages: { create: sdkCreate } } as never;
    const registry = new Registry();
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(registry) });

    const messages: LLMMessage[] = [
      { role: "system", content: "you are helpful", cache_control: { type: "ephemeral" } },
      { role: "system", content: "graph-context slice goes here", cache_control: { type: "ephemeral" } },
      { role: "user", content: "what's up?" }
    ];
    const result = await provider.complete(messages, { model: "claude-sonnet-4-6", maxTokens: 1024 });

    expect(result.content).toBe("hello back");
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.cacheReadInputTokens).toBe(50);

    expect(sdkCreate).toHaveBeenCalledOnce();
    const call = sdkCreate.mock.calls[0][0] as Record<string, unknown>;
    // System prompt must be structured array with cache_control blocks (Anthropic's format)
    expect(Array.isArray(call.system)).toBe(true);
    const sys = call.system as Array<Record<string, unknown>>;
    expect(sys).toHaveLength(2);
    expect(sys[0]).toMatchObject({ type: "text", text: "you are helpful", cache_control: { type: "ephemeral" } });
    expect(sys[1]).toMatchObject({ type: "text", text: "graph-context slice goes here", cache_control: { type: "ephemeral" } });
    // User message is under `messages`
    expect((call.messages as Array<{ role: string; content: string }>)[0]).toMatchObject({ role: "user", content: "what's up?" });
  });

  it("translates Anthropic API errors into ProviderError subclasses", async () => {
    const sdkCreate = vi.fn(async () => {
      const err: Error & { status?: number } = new Error("429 rate limited");
      err.status = 429;
      throw err;
    });
    const sdk = { messages: { create: sdkCreate } } as never;
    const registry = new Registry();
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(registry) });
    await expect(provider.complete([{ role: "user", content: "hi" }], { model: "claude-sonnet-4-6", maxTokens: 100 }))
      .rejects.toMatchObject({ name: "RateLimitError" });
  });
});
