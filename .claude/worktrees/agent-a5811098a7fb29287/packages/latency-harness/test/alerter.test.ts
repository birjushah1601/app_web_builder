import { describe, it, expect, vi } from "vitest";
import { BudgetAlerter, type LatencyAlert } from "../src/alerter.js";
import { BUDGETS } from "../src/budgets.js";

describe("BudgetAlerter", () => {
  it("fires after N consecutive windows over budget", async () => {
    const alerts: LatencyAlert[] = [];
    const alerter = new BudgetAlerter({
      budgets: BUDGETS,
      consecutiveExceeded: 3,
      sink: { emit: async (a) => { alerts.push(a); } }
    });

    // Cosmetic budget p50=200ms. Window of 250ms p50 → exceeded.
    for (let i = 0; i < 3; i++) {
      await alerter.evaluate({ tier: "cosmetic", windowP50Ms: 250, windowP95Ms: 1500, sampleCount: 100 });
    }

    expect(alerts).toHaveLength(1);
    expect(alerts[0].tier).toBe("cosmetic");
    expect(alerts[0].metric).toBe("p50");
    expect(alerts[0].observedMs).toBe(250);
    expect(alerts[0].budgetMs).toBe(200);
  });

  it("does not fire under threshold", async () => {
    const alerts: LatencyAlert[] = [];
    const alerter = new BudgetAlerter({ budgets: BUDGETS, consecutiveExceeded: 3, sink: { emit: async (a) => { alerts.push(a); } } });
    for (let i = 0; i < 10; i++) {
      await alerter.evaluate({ tier: "cosmetic", windowP50Ms: 150, windowP95Ms: 700, sampleCount: 100 });
    }
    expect(alerts).toHaveLength(0);
  });

  it("resets consecutive count when a healthy window arrives", async () => {
    const alerts: LatencyAlert[] = [];
    const alerter = new BudgetAlerter({ budgets: BUDGETS, consecutiveExceeded: 3, sink: { emit: async (a) => { alerts.push(a); } } });
    await alerter.evaluate({ tier: "cosmetic", windowP50Ms: 250, windowP95Ms: 700, sampleCount: 100 });
    await alerter.evaluate({ tier: "cosmetic", windowP50Ms: 250, windowP95Ms: 700, sampleCount: 100 });
    await alerter.evaluate({ tier: "cosmetic", windowP50Ms: 150, windowP95Ms: 700, sampleCount: 100 }); // healthy → reset
    await alerter.evaluate({ tier: "cosmetic", windowP50Ms: 250, windowP95Ms: 700, sampleCount: 100 });
    expect(alerts).toHaveLength(0);
  });
});
