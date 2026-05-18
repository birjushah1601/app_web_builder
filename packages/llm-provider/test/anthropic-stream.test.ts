import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider } from "../src/anthropic.js";
import { createProviderMetrics } from "../src/observability.js";

describe("AnthropicProvider.stream", () => {
  it("yields content_delta chunks then message_stop", async () => {
    async function* fakeStream() {
      yield { type: "message_start" };
      yield { type: "content_block_delta", delta: { text: "hello " } };
      yield { type: "content_block_delta", delta: { text: "world" } };
      yield { type: "message_delta", delta: { stop_reason: "end_turn" } };
    }
    const sdk = { messages: { stream: vi.fn(() => fakeStream()) } } as never;
    const registry = new Registry();
    const provider = new AnthropicProvider({ sdk, metrics: createProviderMetrics(registry) });

    const collected: string[] = [];
    let stopReason: string | undefined;
    for await (const chunk of provider.stream(
      [{ role: "user", content: "hi" }],
      { model: "claude-sonnet-4-6", maxTokens: 100 }
    )) {
      if (chunk.type === "content_delta") collected.push(chunk.delta);
      else if (chunk.type === "message_stop") stopReason = chunk.stopReason;
    }
    expect(collected.join("")).toBe("hello world");
    expect(stopReason).toBe("end_turn");
  });
});
