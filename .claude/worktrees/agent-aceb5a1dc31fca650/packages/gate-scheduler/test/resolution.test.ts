import { describe, it, expect, vi } from "vitest";
import { ResolutionFlow, type ResolutionChoice } from "../src/resolution.js";

describe("ResolutionFlow", () => {
  it("retry-with-hint increments attempt + invokes the runner", async () => {
    const runner = vi.fn(async () => ({ layer: "L4" as const, status: "failed" as const, summary: "again" }));
    const flow = new ResolutionFlow({ maxRetries: 3 });
    const r1 = await flow.choose({ kind: "retry-with-hint", hint: "tighten CORS allowlist" }, runner);
    expect(runner).toHaveBeenCalledOnce();
    expect(flow.attempts).toBe(1);
    expect(r1.status).toBe("failed");
  });

  it("undo invokes the rollback arm + does not call runner", async () => {
    const runner = vi.fn();
    const rollback = vi.fn(async () => ({ success: true }));
    const flow = new ResolutionFlow({ maxRetries: 3 });
    const result = await flow.choose({ kind: "undo", rollback } as never, runner);
    expect(rollback).toHaveBeenCalledOnce();
    expect(runner).not.toHaveBeenCalled();
    expect((result as { kind: string }).kind).toBe("undone");
  });

  it("risk-accept invokes engine.acceptRisk + does not call runner", async () => {
    const runner = vi.fn();
    const acceptRisk = vi.fn(async () => {});
    const flow = new ResolutionFlow({ maxRetries: 3 });
    const result = await flow.choose({
      kind: "risk-accept",
      acceptRisk,
      ritualId: "r-1",
      event: {
        gate: "L4-security",
        failureSummary: "wildcard CORS for legacy",
        acceptedBy: { personaTier: "diego", userId: "u", timestamp: "t" },
        rationale: "twenty character rationale here",
        scope: "session"
      }
    } as never, runner);
    expect(acceptRisk).toHaveBeenCalledOnce();
    expect(runner).not.toHaveBeenCalled();
    expect((result as { kind: string }).kind).toBe("risk-accepted");
  });

  it("max retries enforced — 4th retry rejects", async () => {
    const runner = vi.fn(async () => ({ layer: "L4" as const, status: "failed" as const, summary: "again" }));
    const flow = new ResolutionFlow({ maxRetries: 3 });
    for (let i = 0; i < 3; i++) {
      await flow.choose({ kind: "retry-with-hint", hint: "h" }, runner);
    }
    await expect(flow.choose({ kind: "retry-with-hint", hint: "h" }, runner)).rejects.toThrow(/max retries/i);
  });
});
