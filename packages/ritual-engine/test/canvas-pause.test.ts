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

  describe("plan-approval kind (Plan UXO Task 7)", () => {
    it("waitForPlanApproval resolves with the user's edited plan", async () => {
      const reg = new CanvasPauseRegistry();
      const promise = reg.waitForPlanApproval({
        ritualId: "r-1",
        timeoutMs: 1000,
        plan: [{ id: "s1", text: "Step one" }, { id: "s2", text: "Step two" }]
      });
      setTimeout(
        () =>
          reg.resolvePlanApproval("r-1", [
            { id: "s1", text: "Step one (edited)" }
          ]),
        5
      );
      const result = await promise;
      expect(result.autoApproved).toBe(false);
      expect(result.approvedPlan).toHaveLength(1);
      expect(result.approvedPlan[0]?.text).toBe("Step one (edited)");
    });

    it("times out → resolves with original plan + autoApproved=true", async () => {
      vi.useFakeTimers();
      const reg = new CanvasPauseRegistry();
      const original = [{ id: "s1", text: "Step one" }];
      const promise = reg.waitForPlanApproval({
        ritualId: "r-1",
        timeoutMs: 100,
        plan: original
      });
      vi.advanceTimersByTime(150);
      const result = await promise;
      expect(result.autoApproved).toBe(true);
      expect(result.approvedPlan).toEqual(original);
      vi.useRealTimers();
    });

    it("resolvePlanApproval with no waiter is a no-op (no throw)", () => {
      const reg = new CanvasPauseRegistry();
      expect(() => reg.resolvePlanApproval("r-1", [])).not.toThrow();
    });

    it("resolveOption does NOT resolve a plan-approval waiter (kind isolation)", async () => {
      const reg = new CanvasPauseRegistry();
      const promise = reg.waitForPlanApproval({
        ritualId: "r-1",
        timeoutMs: 1000,
        plan: [{ id: "s1", text: "x" }]
      });
      // Wrong-kind resolve must be a no-op so a stale option-select call
      // can't accidentally drain a plan-approval waiter.
      reg.resolveOption("r-1", { directionId: "wrong", tokens: {} });
      expect(reg.pendingCount()).toBe(1);
      reg.resolvePlanApproval("r-1", [{ id: "s1", text: "y" }]);
      const result = await promise;
      expect(result.approvedPlan[0]?.text).toBe("y");
    });

    it("resolvePlanApproval does NOT resolve an option-select waiter (kind isolation)", async () => {
      const reg = new CanvasPauseRegistry();
      const promise = reg.waitForOption({
        ritualId: "r-1",
        timeoutMs: 1000,
        recommendedFallback: { directionId: "rec", tokens: {} }
      });
      reg.resolvePlanApproval("r-1", [{ id: "s1", text: "x" }]);
      expect(reg.pendingCount()).toBe(1);
      reg.resolveOption("r-1", { directionId: "selected", tokens: {} });
      const result = await promise;
      expect(result.directionId).toBe("selected");
    });

    it("dispose clears a pending plan-approval waiter without resolving", () => {
      const reg = new CanvasPauseRegistry();
      void reg.waitForPlanApproval({
        ritualId: "r-1",
        timeoutMs: 1000,
        plan: [{ id: "s1", text: "x" }]
      });
      expect(reg.pendingCount()).toBe(1);
      reg.dispose("r-1");
      expect(reg.pendingCount()).toBe(0);
    });
  });

  describe("triage-clarifications kind (Plan U slice 3)", () => {
    it("waitForTriageClarifications resolves with the user's answers", async () => {
      const reg = new CanvasPauseRegistry();
      const promise = reg.waitForTriageClarifications({
        ritualId: "r-u-1",
        timeoutMs: 1000,
        fallbackAnswers: {}
      });
      setTimeout(
        () =>
          reg.resolveTriageClarifications("r-u-1", {
            q0: "Stripe",
            q1: "Yes"
          }),
        5
      );
      const result = await promise;
      expect(result.autoResolved).toBe(false);
      expect(result.answers).toEqual({ q0: "Stripe", q1: "Yes" });
    });

    it("times out → resolves with fallbackAnswers + autoResolved=true", async () => {
      vi.useFakeTimers();
      const reg = new CanvasPauseRegistry();
      const promise = reg.waitForTriageClarifications({
        ritualId: "r-u-1",
        timeoutMs: 100,
        fallbackAnswers: { q0: "scope-default" }
      });
      vi.advanceTimersByTime(150);
      const result = await promise;
      expect(result.autoResolved).toBe(true);
      expect(result.answers).toEqual({ q0: "scope-default" });
      vi.useRealTimers();
    });

    it("resolveTriageClarifications with no waiter is a no-op (no throw)", () => {
      const reg = new CanvasPauseRegistry();
      expect(() => reg.resolveTriageClarifications("r-1", { q0: "x" })).not.toThrow();
    });

    it("double-resolve is safe (second resolve is no-op)", async () => {
      const reg = new CanvasPauseRegistry();
      const promise = reg.waitForTriageClarifications({
        ritualId: "r-u-1",
        timeoutMs: 1000,
        fallbackAnswers: {}
      });
      reg.resolveTriageClarifications("r-u-1", { q0: "first" });
      reg.resolveTriageClarifications("r-u-1", { q0: "second" });
      const r = await promise;
      expect(r.answers).toEqual({ q0: "first" });
    });

    it("resolveOption does NOT resolve a triage-clarifications waiter (kind isolation)", async () => {
      const reg = new CanvasPauseRegistry();
      const promise = reg.waitForTriageClarifications({
        ritualId: "r-u-1",
        timeoutMs: 1000,
        fallbackAnswers: {}
      });
      reg.resolveOption("r-u-1", { directionId: "wrong-kind", tokens: {} });
      expect(reg.pendingCount()).toBe(1);
      reg.resolveTriageClarifications("r-u-1", { q0: "correct" });
      const result = await promise;
      expect(result.answers).toEqual({ q0: "correct" });
    });

    it("resolveTriageClarifications does NOT resolve a plan-approval waiter (kind isolation)", async () => {
      const reg = new CanvasPauseRegistry();
      const promise = reg.waitForPlanApproval({
        ritualId: "r-u-1",
        timeoutMs: 1000,
        plan: [{ id: "s1", text: "x" }]
      });
      reg.resolveTriageClarifications("r-u-1", { q0: "x" });
      expect(reg.pendingCount()).toBe(1);
      reg.resolvePlanApproval("r-u-1", [{ id: "s1", text: "y" }]);
      const result = await promise;
      expect(result.approvedPlan[0]?.text).toBe("y");
    });

    it("dispose clears a pending triage-clarifications waiter without resolving", () => {
      const reg = new CanvasPauseRegistry();
      void reg.waitForTriageClarifications({
        ritualId: "r-u-1",
        timeoutMs: 1000,
        fallbackAnswers: {}
      });
      expect(reg.pendingCount()).toBe(1);
      reg.dispose("r-u-1");
      expect(reg.pendingCount()).toBe(0);
    });
  });
});
