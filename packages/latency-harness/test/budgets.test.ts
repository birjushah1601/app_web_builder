import { describe, it, expect } from "vitest";
import { BudgetSchema, BUDGETS, type Budget } from "../src/budgets.js";

describe("budgets", () => {
  it("BUDGETS has entries for all 3 tiers", () => {
    expect(BUDGETS.cosmetic).toBeDefined();
    expect(BUDGETS.structural).toBeDefined();
    expect(BUDGETS["security-compliance-touching"]).toBeDefined();
  });

  it("BUDGETS.cosmetic matches PRD NFR-8 (P50 200ms, P95 800ms)", () => {
    expect(BUDGETS.cosmetic.p50Ms).toBe(200);
    expect(BUDGETS.cosmetic.p95Ms).toBe(800);
  });

  it("BUDGETS.structural P50 ≤ structural P95 ≤ SC-touching P95", () => {
    expect(BUDGETS.structural.p50Ms).toBeLessThanOrEqual(BUDGETS.structural.p95Ms);
    expect(BUDGETS.structural.p95Ms).toBeLessThanOrEqual(BUDGETS["security-compliance-touching"].p95Ms);
  });

  it("BudgetSchema parses a custom budget", () => {
    const b: Budget = { p50Ms: 100, p95Ms: 500 };
    expect(BudgetSchema.parse(b)).toEqual(b);
  });

  it("BudgetSchema rejects p95 < p50", () => {
    expect(() => BudgetSchema.parse({ p50Ms: 500, p95Ms: 100 })).toThrow();
  });
});
