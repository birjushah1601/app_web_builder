import { describe, it, expect } from "vitest";
import { InMemoryUsageTracker, computeUsd, MODEL_PRICING } from "../src/usage-tracker.js";

describe("InMemoryUsageTracker", () => {
  it("starts at $0.00", () => {
    const t = new InMemoryUsageTracker();
    expect(t.totalUsd()).toBe(0);
  });
  it("accumulates token cost across multiple records", () => {
    const t = new InMemoryUsageTracker();
    t.record("anthropic", "claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 0 });
    expect(t.totalUsd()).toBeCloseTo(3.00, 4);
    t.record("anthropic", "claude-sonnet-4-6", { inputTokens: 0, outputTokens: 1_000_000 });
    expect(t.totalUsd()).toBeCloseTo(18.00, 4);
  });
  it("treats an unknown model as zero cost (logged but not summed)", () => {
    const t = new InMemoryUsageTracker();
    t.record("anthropic", "no-such-model", { inputTokens: 10_000_000, outputTokens: 0 });
    expect(t.totalUsd()).toBe(0);
  });
});

describe("computeUsd", () => {
  it("multiplies tokens by the model's per-MTok pricing", () => {
    const cost = computeUsd("anthropic", "claude-sonnet-4-6", { inputTokens: 500_000, outputTokens: 100_000 });
    // 500K * $3 / 1M + 100K * $15 / 1M = $1.50 + $1.50 = $3.00
    expect(cost).toBeCloseTo(3.00, 4);
  });
  it("returns 0 for an unknown model", () => {
    const cost = computeUsd("anthropic", "no-such-model", { inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost).toBe(0);
  });
});

describe("MODEL_PRICING", () => {
  it("includes the three currently-used models", () => {
    expect(MODEL_PRICING["anthropic:claude-sonnet-4-6"]).toBeDefined();
    expect(MODEL_PRICING["anthropic:claude-haiku-4-5"]).toBeDefined();
    expect(MODEL_PRICING["google:gemini-2.5-flash"]).toBeDefined();
  });
});
