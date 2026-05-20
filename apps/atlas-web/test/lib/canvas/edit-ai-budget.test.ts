import { describe, it, expect, beforeEach } from "vitest";
import { readBudget, tryConsume, __resetEditAiBudgetForTesting } from "@/lib/canvas/edit-ai-budget";

describe("edit-ai-budget", () => {
  beforeEach(() => {
    __resetEditAiBudgetForTesting();
    delete process.env.ATLAS_EDIT_AI_DAILY_CAP;
  });

  it("starts at 0/50 by default", () => {
    const b = readBudget("p1");
    expect(b.used).toBe(0);
    expect(b.cap).toBe(50);
    expect(b.remaining).toBe(50);
    expect(b.warning).toBe(false);
    expect(b.exhausted).toBe(false);
  });

  it("flips warning at 80% (40/50)", () => {
    for (let i = 0; i < 40; i++) tryConsume("p1");
    const b = readBudget("p1");
    expect(b.used).toBe(40);
    expect(b.warning).toBe(true);
    expect(b.exhausted).toBe(false);
  });

  it("flips exhausted at 100% and does not increment further", () => {
    process.env.ATLAS_EDIT_AI_DAILY_CAP = "3";
    tryConsume("p1");
    tryConsume("p1");
    tryConsume("p1");
    expect(readBudget("p1").exhausted).toBe(true);
    const b = tryConsume("p1");
    expect(b.used).toBe(3); // did not increment past cap
  });

  it("tracks counts per-project", () => {
    tryConsume("p1");
    tryConsume("p1");
    tryConsume("p2");
    expect(readBudget("p1").used).toBe(2);
    expect(readBudget("p2").used).toBe(1);
  });
});
