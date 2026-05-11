import { describe, it, expect } from "vitest";
import { timelineReducer, initialTimelineState } from "@/lib/ritual/timelineReducer";
import type { RitualEvent } from "@/lib/events/EventBroker";

function evt(type: RitualEvent["type"], payload: Record<string, unknown> = {}): RitualEvent {
  return { id: "x:1", projectId: "p", ritualId: "r", type, payload, ts: 1000 };
}

describe("timelineReducer — gates + auto-fix (Plan P Task 3)", () => {
  it("security.started flips security row to active", () => {
    const out = timelineReducer(initialTimelineState, evt("security.started"));
    expect(out.rows.security.status).toBe("active");
  });

  it("security.completed (passed=true) flips security row to done", () => {
    const after = timelineReducer(initialTimelineState, evt("security.started"));
    const out = timelineReducer(after, evt("security.completed", { passed: true }));
    expect(out.rows.security.status).toBe("done");
  });

  it("security.failed flips security row to failed and captures error", () => {
    const after = timelineReducer(initialTimelineState, evt("security.started"));
    const out = timelineReducer(after, evt("security.failed", { error: "timeout" }));
    expect(out.rows.security.status).toBe("failed");
    expect(out.rows.security.lastError).toBe("timeout");
  });

  it("accessibility.* mirrors security.* on its own row", () => {
    let s = timelineReducer(initialTimelineState, evt("accessibility.started"));
    expect(s.rows.accessibility.status).toBe("active");
    s = timelineReducer(s, evt("accessibility.completed", { passed: false }));
    expect(s.rows.accessibility.status).toBe("done");
  });

  it("auto_fix.attempted increments autoFixAttempts", () => {
    let s = timelineReducer(initialTimelineState, evt("auto_fix.attempted", { gate: "L4-security", attemptNumber: 1, parentRitualId: "r" }));
    expect(s.autoFixAttempts).toBe(1);
    s = timelineReducer(s, evt("auto_fix.attempted", { gate: "L4-security", attemptNumber: 2, parentRitualId: "r" }));
    expect(s.autoFixAttempts).toBe(2);
  });

  it("auto_fix.budget_exhausted flips autoFixExhausted", () => {
    const s = timelineReducer(initialTimelineState, evt("auto_fix.budget_exhausted", { gate: "L4-security", attempts: 2 }));
    expect(s.autoFixExhausted).toBe(true);
  });

  it("auto_fix.failed captures the error", () => {
    const s = timelineReducer(initialTimelineState, evt("auto_fix.failed", { gate: "L4-security", error: "LLM 503" }));
    expect(s.autoFixFailed).toBe("LLM 503");
  });

  it("ritual.started resets autoFixAttempts AND row states", () => {
    let s = timelineReducer(initialTimelineState, evt("auto_fix.attempted", { gate: "L4-security", attemptNumber: 1, parentRitualId: "r" }));
    expect(s.autoFixAttempts).toBe(1);
    s = timelineReducer(s, evt("ritual.started"));
    expect(s.autoFixAttempts).toBe(0);
    expect(s.rows.security.status).toBe("pending");
  });

  it("ritual.escalation_requested flips escalated (Plan I gate-failure path)", () => {
    const s = timelineReducer(initialTimelineState, evt("ritual.escalation_requested", { reason: "L4-security-gate-failed", requestedBy: "security" }));
    expect(s.escalated).toBe(true);
  });
});
