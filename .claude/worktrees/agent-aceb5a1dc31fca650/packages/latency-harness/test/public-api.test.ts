import { describe, it, expect } from "vitest";
import {
  LatencyHarness,
  BUDGETS,
  Sampler,
  SlidingWindow,
  BudgetAlerter,
  createLatencyHistograms
} from "../src/index.js";

describe("public API", () => {
  it("exports LatencyHarness", () => {
    expect(LatencyHarness).toBeDefined();
  });
  it("exports BUDGETS", () => {
    expect(BUDGETS).toBeDefined();
  });
  it("exports Sampler", () => {
    expect(Sampler).toBeDefined();
  });
  it("exports SlidingWindow", () => {
    expect(SlidingWindow).toBeDefined();
  });
  it("exports BudgetAlerter", () => {
    expect(BudgetAlerter).toBeDefined();
  });
  it("exports createLatencyHistograms", () => {
    expect(createLatencyHistograms).toBeDefined();
  });
});
