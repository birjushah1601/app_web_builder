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

describe("InMemoryUsageTracker — per-role breakdown (Plan G.3)", () => {
  it("buckets cost under the provided roleId", () => {
    const t = new InMemoryUsageTracker();
    t.record("anthropic", "claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 0 }, { roleId: "developer" });
    const b = t.breakdown();
    expect(b).toHaveLength(1);
    expect(b[0]!.roleId).toBe("developer");
    expect(b[0]!.totalUsd).toBeCloseTo(3.0, 4);
    expect(b[0]!.callCount).toBe(1);
  });

  it("accumulates cost + callCount across multiple records for the same role", () => {
    const t = new InMemoryUsageTracker();
    t.record("anthropic", "claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 0 }, { roleId: "developer" });
    t.record("anthropic", "claude-sonnet-4-6", { inputTokens: 0, outputTokens: 1_000_000 }, { roleId: "developer" });
    const b = t.breakdown();
    expect(b).toHaveLength(1);
    expect(b[0]!.roleId).toBe("developer");
    expect(b[0]!.totalUsd).toBeCloseTo(18.0, 4);
    expect(b[0]!.callCount).toBe(2);
  });

  it("buckets records without a roleId under __unassigned__", () => {
    const t = new InMemoryUsageTracker();
    t.record("anthropic", "claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 0 });
    const b = t.breakdown();
    expect(b).toHaveLength(1);
    expect(b[0]!.roleId).toBe("__unassigned__");
    expect(b[0]!.totalUsd).toBeCloseTo(3.0, 4);
    expect(b[0]!.callCount).toBe(1);
  });

  it("returns multiple buckets sorted by totalUsd desc", () => {
    const t = new InMemoryUsageTracker();
    // architect: cheap
    t.record("anthropic", "claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 0 }, { roleId: "architect" });
    // developer: expensive
    t.record("anthropic", "claude-opus-4-7", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, { roleId: "developer" });
    // tester: middle
    t.record("anthropic", "claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 0 }, { roleId: "tester" });

    const b = t.breakdown();
    expect(b).toHaveLength(3);
    expect(b.map((e) => e.roleId)).toEqual(["developer", "tester", "architect"]);
    // monotonic descending
    expect(b[0]!.totalUsd).toBeGreaterThan(b[1]!.totalUsd);
    expect(b[1]!.totalUsd).toBeGreaterThan(b[2]!.totalUsd);
  });

  it("totalUsd() continues to return the cross-role sum", () => {
    const t = new InMemoryUsageTracker();
    t.record("anthropic", "claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 0 }, { roleId: "developer" });
    t.record("anthropic", "claude-sonnet-4-6", { inputTokens: 1_000_000, outputTokens: 0 }, { roleId: "tester" });
    expect(t.totalUsd()).toBeCloseTo(6.0, 4);
  });

  it("breakdown() on an empty tracker returns []", () => {
    const t = new InMemoryUsageTracker();
    expect(t.breakdown()).toEqual([]);
  });

  it("zero-cost unknown model still increments callCount", () => {
    const t = new InMemoryUsageTracker();
    t.record("anthropic", "no-such-model", { inputTokens: 1_000_000, outputTokens: 0 }, { roleId: "developer" });
    const b = t.breakdown();
    expect(b).toHaveLength(1);
    expect(b[0]!.roleId).toBe("developer");
    expect(b[0]!.totalUsd).toBe(0);
    expect(b[0]!.callCount).toBe(1);
  });
});

describe("computeUsd — dated model ID normalization", () => {
  it("strips a trailing -YYYYMMDD suffix and matches the undated key", () => {
    const cost = computeUsd("anthropic", "claude-haiku-4-5-20251001", { inputTokens: 1_000_000, outputTokens: 0 });
    // claude-haiku-4-5 inputPerMTok = $1.00 → 1M * $1 / 1M = $1.00
    expect(cost).toBeCloseTo(1.00, 4);
  });

  it("still returns 0 for a non-existent base model with a date suffix", () => {
    const cost = computeUsd("anthropic", "no-such-model-20251001", { inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost).toBe(0);
  });

  it("does not strip suffixes that aren't dates (e.g. -latest)", () => {
    // -latest isn't a YYYYMMDD pattern; should NOT match undated claude-sonnet-4-6
    const cost = computeUsd("anthropic", "claude-sonnet-4-6-latest", { inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost).toBe(0);
  });
});
