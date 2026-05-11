import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { E2BLifecycle, type SpendRecorder } from "../src/lifecycle.js";

vi.mock("@e2b/sdk", () => ({
  Sandbox: { create: vi.fn() }
}));

import { Sandbox as MockSandbox } from "@e2b/sdk";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("E2BLifecycle spend recording", () => {
  let fakeSandbox: Record<string, unknown>;
  let record: ReturnType<typeof vi.fn>;
  let recorder: SpendRecorder;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fakeSandbox = {
      sandboxId: "sbx_abc123",
      kill: vi.fn().mockResolvedValue(undefined)
    };
    (MockSandbox.create as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSandbox);
    record = vi.fn().mockResolvedValue(undefined);
    recorder = { record };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records spend on terminate when spendRecorder is configured", async () => {
    vi.setSystemTime(new Date("2026-04-22T00:00:00.000Z"));
    const lifecycle = new E2BLifecycle({
      apiKey: "x",
      templateDigests: { "atlas-next-ts": "d" },
      spendRecorder: recorder
    });
    const r = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    vi.setSystemTime(new Date("2026-04-22T01:00:00.000Z"));
    await lifecycle.terminate(r.sandboxId);
    expect(record).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sandboxId: "sbx_abc123",
      usdAmount: expect.closeTo(0.017, 4)
    });
  });

  it("uses the overridden hourlyRateUsd", async () => {
    vi.setSystemTime(new Date("2026-04-22T00:00:00.000Z"));
    const lifecycle = new E2BLifecycle({
      apiKey: "x",
      templateDigests: { "atlas-next-ts": "d" },
      spendRecorder: recorder,
      hourlyRateUsd: 0.05
    });
    const r = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    vi.setSystemTime(new Date("2026-04-22T00:30:00.000Z"));
    await lifecycle.terminate(r.sandboxId);
    // 30 minutes at $0.05/hr = $0.025
    const call = record.mock.calls[0]?.[0] as { usdAmount: number } | undefined;
    expect(call?.usdAmount).toBeCloseTo(0.025, 4);
  });

  it("does not record when no spendRecorder is configured", async () => {
    const lifecycle = new E2BLifecycle({
      apiKey: "x",
      templateDigests: { "atlas-next-ts": "d" }
    });
    const r = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    await lifecycle.terminate(r.sandboxId);
    expect(record).not.toHaveBeenCalled();
  });

  it("swallows recorder failures — terminate still succeeds", async () => {
    record.mockRejectedValueOnce(new Error("db down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lifecycle = new E2BLifecycle({
      apiKey: "x",
      templateDigests: { "atlas-next-ts": "d" },
      spendRecorder: recorder
    });
    const r = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    await expect(lifecycle.terminate(r.sandboxId)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("records zero spend when duration is zero", async () => {
    const lifecycle = new E2BLifecycle({
      apiKey: "x",
      templateDigests: { "atlas-next-ts": "d" },
      spendRecorder: recorder
    });
    vi.setSystemTime(new Date("2026-04-22T00:00:00.000Z"));
    const r = await lifecycle.provision("atlas-next-ts", PROJECT_ID);
    // no time advance
    await lifecycle.terminate(r.sandboxId);
    const call = record.mock.calls[0]?.[0] as { usdAmount: number } | undefined;
    expect(call?.usdAmount).toBe(0);
  });
});
