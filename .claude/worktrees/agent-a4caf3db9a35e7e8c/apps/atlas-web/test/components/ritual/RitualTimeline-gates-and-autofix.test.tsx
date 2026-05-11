import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const useTimelineStateMock = vi.fn();
vi.mock("@/lib/ritual/useTimelineState", () => ({
  useTimelineState: () => useTimelineStateMock()
}));
vi.mock("@/components/ritual/RitualTimelineRow", () => ({
  RitualTimelineRow: ({ row, title }: { row: { status: string; phase: string }; title: string }) => (
    <div data-testid={`row-${row.phase}`} data-status={row.status}>{title}</div>
  )
}));
vi.mock("@/components/EscalationCallout", () => ({
  EscalationCallout: () => <div data-testid="escalation-callout" />
}));

import { RitualTimeline } from "@/components/ritual/RitualTimeline";

describe("RitualTimeline — gates + auto-fix (Plan P Task 4)", () => {
  it("renders security row when status is active (gate just started)", () => {
    useTimelineStateMock.mockReturnValue({
      escalated: false,
      autoFixAttempts: 0,
      autoFixExhausted: false,
      rows: {
        architect:     { phase: "architect",     status: "done",    retries: 0 },
        developer:     { phase: "developer",     status: "done",    retries: 0 },
        sandbox:       { phase: "sandbox",       status: "done",    retries: 0 },
        security:      { phase: "security",      status: "active",  retries: 0 },
        accessibility: { phase: "accessibility", status: "pending", retries: 0 }
      }
    });
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.getByTestId("row-security")).toBeInTheDocument();
    expect(screen.queryByTestId("row-accessibility")).not.toBeInTheDocument();
  });

  it("hides BOTH gate rows when both are pending (gates flag-OFF)", () => {
    useTimelineStateMock.mockReturnValue({
      escalated: false,
      autoFixAttempts: 0,
      autoFixExhausted: false,
      rows: {
        architect:     { phase: "architect",     status: "done",    retries: 0 },
        developer:     { phase: "developer",     status: "done",    retries: 0 },
        sandbox:       { phase: "sandbox",       status: "done",    retries: 0 },
        security:      { phase: "security",      status: "pending", retries: 0 },
        accessibility: { phase: "accessibility", status: "pending", retries: 0 }
      }
    });
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.queryByTestId("row-security")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-accessibility")).not.toBeInTheDocument();
    // Core 3 rows always render.
    expect(screen.getByTestId("row-architect")).toBeInTheDocument();
    expect(screen.getByTestId("row-developer")).toBeInTheDocument();
    expect(screen.getByTestId("row-sandbox")).toBeInTheDocument();
  });

  it("renders 'Auto-fix #N in progress' when autoFixAttempts > 0", () => {
    useTimelineStateMock.mockReturnValue({
      escalated: true,
      autoFixAttempts: 1,
      autoFixExhausted: false,
      rows: {
        architect:     { phase: "architect",     status: "done",   retries: 0 },
        developer:     { phase: "developer",     status: "done",   retries: 0 },
        sandbox:       { phase: "sandbox",       status: "done",   retries: 0 },
        security:      { phase: "security",      status: "failed", retries: 0 },
        accessibility: { phase: "accessibility", status: "pending", retries: 0 }
      }
    });
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.getByTestId("auto-fix-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("auto-fix-indicator").textContent).toMatch(/Auto-fix #1 in progress/);
  });

  it("renders 'budget reached' when autoFixExhausted is true", () => {
    useTimelineStateMock.mockReturnValue({
      escalated: true,
      autoFixAttempts: 2,
      autoFixExhausted: true,
      rows: {
        architect:     { phase: "architect",     status: "done",   retries: 0 },
        developer:     { phase: "developer",     status: "done",   retries: 0 },
        sandbox:       { phase: "sandbox",       status: "done",   retries: 0 },
        security:      { phase: "security",      status: "failed", retries: 0 },
        accessibility: { phase: "accessibility", status: "pending", retries: 0 }
      }
    });
    render(<RitualTimeline projectId="p-1" />);
    expect(screen.getByTestId("auto-fix-indicator").textContent).toMatch(/budget reached \(2 attempts\)/);
  });
});
