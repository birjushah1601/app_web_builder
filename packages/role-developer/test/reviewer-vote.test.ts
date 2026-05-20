import { describe, it, expect, vi } from "vitest";
import { Registry } from "prom-client";
import { AnthropicProvider, createProviderMetrics } from "@atlas/llm-provider";
import { reviewerVote, DEVELOPER_REVIEWER_MODEL } from "../src/reviewer-vote.js";

describe("reviewerVote", () => {
  it("returns the LLM's vote with reasoning", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu-vote", name: "emit_reviewer_vote", input: { winner: "google", reasoning: "smaller diff with equivalent coverage" } }],
      model: DEVELOPER_REVIEWER_MODEL,
      stop_reason: "tool_use",
      usage: { input_tokens: 50, output_tokens: 10 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });

    const vote = await reviewerVote({
      llm,
      anthropicOutput: { diff: "anth diff", summary: "a", testsAdded: [], filesModified: ["x.ts"] },
      googleOutput: { diff: "gog diff", summary: "g", testsAdded: [], filesModified: ["x.ts"] }
    });
    expect(vote.winner).toBe("google");
    expect(vote.reasoning).toContain("smaller diff");
  });

  it("forces tool-use to emit_reviewer_vote (no free-form text)", async () => {
    const sdkCreate = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "tu", name: "emit_reviewer_vote", input: { winner: "anthropic", reasoning: "ok" } }],
      model: DEVELOPER_REVIEWER_MODEL,
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 1 }
    }));
    const sdk = { messages: { create: sdkCreate, stream: vi.fn() } } as never;
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(new Registry()) });
    await reviewerVote({
      llm,
      anthropicOutput: { diff: "a", summary: "a", testsAdded: [], filesModified: ["a"] },
      googleOutput: { diff: "g", summary: "g", testsAdded: [], filesModified: ["g"] }
    });
    const body = sdkCreate.mock.calls[0][0] as { tool_choice?: { type: string; name: string } };
    expect(body.tool_choice).toEqual({ type: "tool", name: "emit_reviewer_vote" });
  });
});
