import { describe, it, expect, vi } from "vitest";
import { reconcileArgoUntilSettled } from "../src/reconcile.js";
import { ReconcileTimeoutError } from "../src/errors.js";

describe("reconcileArgoUntilSettled", () => {
  it("returns Healthy when client reports Healthy", async () => {
    const k8s = { argoApplicationHealth: vi.fn().mockResolvedValue("Healthy") } as never;
    const result = await reconcileArgoUntilSettled(k8s, "p-abc-main", { intervalMs: 10, timeoutMs: 1000 });
    expect(result).toBe("Healthy");
  });

  it("returns Degraded when client reports Degraded", async () => {
    const k8s = { argoApplicationHealth: vi.fn().mockResolvedValue("Degraded") } as never;
    const result = await reconcileArgoUntilSettled(k8s, "p-abc-main", { intervalMs: 10, timeoutMs: 1000 });
    expect(result).toBe("Degraded");
  });

  it("polls past Progressing into Healthy", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce("Progressing")
      .mockResolvedValueOnce("Progressing")
      .mockResolvedValueOnce("Healthy");
    const k8s = { argoApplicationHealth: fn } as never;
    const result = await reconcileArgoUntilSettled(k8s, "p-abc-main", { intervalMs: 5, timeoutMs: 1000 });
    expect(result).toBe("Healthy");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws ReconcileTimeoutError when timeout elapses without settled state", async () => {
    const k8s = { argoApplicationHealth: vi.fn().mockResolvedValue("Progressing") } as never;
    await expect(
      reconcileArgoUntilSettled(k8s, "p-abc-main", { intervalMs: 5, timeoutMs: 30 })
    ).rejects.toThrow(ReconcileTimeoutError);
  });
});
