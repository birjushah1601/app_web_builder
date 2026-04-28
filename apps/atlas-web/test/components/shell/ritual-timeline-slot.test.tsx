import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React, { Suspense } from "react";

beforeEach(() => {
  vi.resetModules();
});

describe("RitualTimelineSlot — placeholder branch (Plan E module not yet shipped)", () => {
  it("renders <div data-testid='ritual-timeline-host' /> when @/components/ritual/RitualTimeline cannot be imported", async () => {
    vi.doMock("@/components/ritual/RitualTimeline", () => {
      throw new Error("module not found (test-forced)");
    });
    const { RitualTimelineSlot } = await import("@/components/shell/ritual-timeline-slot");
    render(
      <Suspense fallback={<div data-testid="suspense-fallback" />}>
        <RitualTimelineSlot projectId="p-1" />
      </Suspense>
    );
    await waitFor(() => {
      expect(screen.getByTestId("ritual-timeline-host")).toBeInTheDocument();
    });
  });
});

describe("RitualTimelineSlot — real component branch (Plan E shipped)", () => {
  it("renders the real <RitualTimeline /> when the module resolves", async () => {
    vi.doMock("@/components/ritual/RitualTimeline", () => ({
      RitualTimeline: ({ projectId }: { projectId: string }) => (
        <div data-testid="ritual-timeline-real">timeline for {projectId}</div>
      )
    }));
    const { RitualTimelineSlot } = await import("@/components/shell/ritual-timeline-slot");
    render(
      <Suspense fallback={<div data-testid="suspense-fallback" />}>
        <RitualTimelineSlot projectId="p-2" />
      </Suspense>
    );
    await waitFor(() => {
      expect(screen.getByTestId("ritual-timeline-real")).toBeInTheDocument();
    });
    expect(screen.getByText(/timeline for p-2/)).toBeInTheDocument();
  });
});
