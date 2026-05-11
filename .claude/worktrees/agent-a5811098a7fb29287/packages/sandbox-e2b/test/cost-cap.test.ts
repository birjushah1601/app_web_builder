import { describe, it, expect, vi } from "vitest";
import { checkSpendCap, type SpendReader, type SpendCapConfig } from "../src/cost-cap.js";
import { SpendCapExceededError } from "../src/errors.js";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

function makeSpendReader(accumulated: number, rollingAverage: number): SpendReader {
  return {
    getAccumulatedSpend: vi.fn().mockResolvedValue(accumulated),
    getRollingAverageSpend: vi.fn().mockResolvedValue(rollingAverage),
  };
}

const BASE_CONFIG: SpendCapConfig = { capUsd: 50, warnMultiplier: 3 };

describe("checkSpendCap", () => {
  it("resolves without error when spend is safely below cap", async () => {
    const reader = makeSpendReader(10, 5);
    await expect(checkSpendCap(PROJECT_ID, reader, BASE_CONFIG)).resolves.toBeUndefined();
  });

  it("throws SpendCapExceededError when accumulated >= cap", async () => {
    const reader = makeSpendReader(50, 10);
    await expect(checkSpendCap(PROJECT_ID, reader, BASE_CONFIG)).rejects.toThrow(
      SpendCapExceededError
    );
  });

  it("throws SpendCapExceededError when accumulated > cap", async () => {
    const reader = makeSpendReader(75, 10);
    await expect(checkSpendCap(PROJECT_ID, reader, BASE_CONFIG)).rejects.toThrow(
      SpendCapExceededError
    );
  });

  it("does not throw when accumulated is 3x rolling average but below cap", async () => {
    // 30 == 3 × 10, still below cap of 50 — should not throw but should warn
    const reader = makeSpendReader(30, 10);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(checkSpendCap(PROJECT_ID, reader, BASE_CONFIG)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("spend alarm")
    );
    warnSpy.mockRestore();
  });

  it("accumulated exactly at cap throws", async () => {
    const reader = makeSpendReader(50, 5);
    await expect(checkSpendCap(PROJECT_ID, reader, BASE_CONFIG)).rejects.toThrow(
      SpendCapExceededError
    );
  });
});
