import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("submitClarificationAnswers action (Plan U slice 3)", () => {
  it("forwards ritualId + answers to registry.resolveTriageClarifications", async () => {
    const resolveTriageClarifications = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveTriageClarifications })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));

    const { submitClarificationAnswers } = await import("@/lib/actions/submitClarificationAnswers");
    await submitClarificationAnswers({
      ritualId: "r-1",
      answers: { q0: "Stripe", q1: "Yes" }
    });

    expect(resolveTriageClarifications).toHaveBeenCalledTimes(1);
    expect(resolveTriageClarifications).toHaveBeenCalledWith("r-1", {
      q0: "Stripe",
      q1: "Yes"
    });
  });

  it("supports empty-answers payload (user pressed Send with all blanks)", async () => {
    const resolveTriageClarifications = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveTriageClarifications })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));

    const { submitClarificationAnswers } = await import("@/lib/actions/submitClarificationAnswers");
    await submitClarificationAnswers({ ritualId: "r-1", answers: {} });

    expect(resolveTriageClarifications).toHaveBeenCalledWith("r-1", {});
  });

  it("throws unauthorized when no user is signed in", async () => {
    const resolveTriageClarifications = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveTriageClarifications })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: null }) }));

    const { submitClarificationAnswers } = await import("@/lib/actions/submitClarificationAnswers");
    await expect(
      submitClarificationAnswers({ ritualId: "r-1", answers: { q0: "x" } })
    ).rejects.toThrow("unauthorized");
    expect(resolveTriageClarifications).not.toHaveBeenCalled();
  });

  it("validates required inputs", async () => {
    const resolveTriageClarifications = vi.fn();
    vi.doMock("@/lib/engine/canvas-pause-singleton", () => ({
      getCanvasPauseRegistry: () => ({ resolveTriageClarifications })
    }));
    vi.doMock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u-1" }) }));

    const { submitClarificationAnswers } = await import("@/lib/actions/submitClarificationAnswers");
    await expect(
      submitClarificationAnswers({ ritualId: "", answers: { q0: "x" } })
    ).rejects.toThrow("ritualId is required");
    await expect(
      submitClarificationAnswers({ ritualId: "r-1", answers: null as unknown as Record<string, string> })
    ).rejects.toThrow("answers must be a Record");
    expect(resolveTriageClarifications).not.toHaveBeenCalled();
  });
});
