import { describe, it, expect, vi } from "vitest";
import { checkKlingCostCap, type KlingSpendReader } from "../src/cost-cap.js";
import { KlingCostCapExceededError } from "../src/errors.js";

const reader = (usd: number): KlingSpendReader => ({
  getAccumulatedSpendUsd: vi.fn(async () => usd)
});

describe("checkKlingCostCap", () => {
  it("passes silently when accumulated below warn threshold", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await checkKlingCostCap("p1", reader(10), { capUsd: 50, warnFraction: 0.8 });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("emits console.warn when accumulated >= warn threshold but < cap", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await checkKlingCostCap("p1", reader(45), { capUsd: 50, warnFraction: 0.8 });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("throws KlingCostCapExceededError when accumulated >= cap", async () => {
    await expect(
      checkKlingCostCap("p1", reader(50), { capUsd: 50, warnFraction: 0.8 })
    ).rejects.toThrow(KlingCostCapExceededError);
  });

  it("exceeded error includes projectId + amounts", async () => {
    try {
      await checkKlingCostCap("p-42", reader(75.5), { capUsd: 50, warnFraction: 0.8 });
    } catch (err) {
      expect((err as Error).message).toContain("p-42");
      expect((err as Error).message).toContain("$75.50");
      expect((err as Error).message).toContain("$50.00");
    }
  });
});
