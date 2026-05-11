import { describe, it, expect, vi } from "vitest";
import { CanvasPauseRegistry } from "../src/canvas-pause.js";

describe("CanvasPauseRegistry", () => {
  it("waitForOption resolves when resolveOption is called", async () => {
    const reg = new CanvasPauseRegistry();
    const promise = reg.waitForOption({
      ritualId: "r-1",
      timeoutMs: 1000,
      recommendedFallback: { directionId: "rec", tokens: { palette: {} } }
    });
    setTimeout(() => reg.resolveOption("r-1", { directionId: "selected", tokens: { palette: { primary: "#000" } } }), 5);
    const result = await promise;
    expect(result.autoSelected).toBe(false);
    expect(result.directionId).toBe("selected");
  });

  it("times out → resolves with recommended + autoSelected=true", async () => {
    vi.useFakeTimers();
    const reg = new CanvasPauseRegistry();
    const promise = reg.waitForOption({
      ritualId: "r-1",
      timeoutMs: 100,
      recommendedFallback: { directionId: "rec", tokens: { palette: {} } }
    });
    vi.advanceTimersByTime(150);
    const result = await promise;
    expect(result.autoSelected).toBe(true);
    expect(result.directionId).toBe("rec");
    vi.useRealTimers();
  });

  it("resolveOption with no waiter is a no-op (no throw)", () => {
    const reg = new CanvasPauseRegistry();
    expect(() => reg.resolveOption("r-1", { directionId: "x", tokens: {} })).not.toThrow();
  });

  it("double-resolve is safe (second resolve is no-op)", async () => {
    const reg = new CanvasPauseRegistry();
    const promise = reg.waitForOption({
      ritualId: "r-1",
      timeoutMs: 1000,
      recommendedFallback: { directionId: "rec", tokens: {} }
    });
    reg.resolveOption("r-1", { directionId: "first", tokens: {} });
    reg.resolveOption("r-1", { directionId: "second", tokens: {} });
    const r = await promise;
    expect(r.directionId).toBe("first");
  });

  it("dispose clears pending waiter without resolving", () => {
    const reg = new CanvasPauseRegistry();
    void reg.waitForOption({
      ritualId: "r-1",
      timeoutMs: 1000,
      recommendedFallback: { directionId: "rec", tokens: {} }
    });
    expect(reg.pendingCount()).toBe(1);
    reg.dispose("r-1");
    expect(reg.pendingCount()).toBe(0);
  });

  it("multiple waiters for distinct ritualIds resolve independently", async () => {
    const reg = new CanvasPauseRegistry();
    const p1 = reg.waitForOption({ ritualId: "r-1", timeoutMs: 1000, recommendedFallback: { directionId: "a", tokens: {} } });
    const p2 = reg.waitForOption({ ritualId: "r-2", timeoutMs: 1000, recommendedFallback: { directionId: "b", tokens: {} } });
    reg.resolveOption("r-2", { directionId: "B-real", tokens: {} });
    reg.resolveOption("r-1", { directionId: "A-real", tokens: {} });
    expect((await p1).directionId).toBe("A-real");
    expect((await p2).directionId).toBe("B-real");
  });
});
