import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Mock the ChatPanel to a stand-in so we don't drag its server-action
// dependency into this unit test — the rail's job is to MOUNT it, not
// exercise its inner behaviour (covered by ChatPanel.test.tsx).
vi.mock("@/components/ChatPanel", () => ({
  ChatPanel: ({ projectId }: { projectId: string }) => (
    <div data-testid="chat-panel-mock">chat for {projectId}</div>
  )
}));

// Mock the timeline slot — its own test file covers the real-vs-placeholder
// branching. Here we only need to assert the rail mounts SOMETHING for it.
vi.mock("@/components/shell/ritual-timeline-slot", () => ({
  RitualTimelineSlot: ({ projectId }: { projectId: string }) => (
    <div data-testid="ritual-timeline-host">timeline slot for {projectId}</div>
  )
}));

// Mock the server action so the test does not need to evaluate it.
vi.mock("@/lib/actions/startRitual", () => ({
  startRitual: vi.fn()
}));

import { RailShell } from "@/components/shell/RailShell";

describe("RailShell — structural contract (Plan G v1)", () => {
  it("renders a header containing the projectId and an 'All projects' link", () => {
    render(<RailShell projectId="proj-abc" />);
    const header = screen.getByRole("banner");
    expect(header).toBeInTheDocument();
    expect(header.textContent).toContain("proj-abc");
    const link = screen.getByRole("link", { name: /all projects/i });
    expect(link).toHaveAttribute("href", "/projects");
  });

  it("mounts the ChatPanel slot with the projectId", () => {
    render(<RailShell projectId="proj-abc" />);
    expect(screen.getByTestId("chat-panel-mock")).toBeInTheDocument();
    expect(screen.getByText(/chat for proj-abc/)).toBeInTheDocument();
  });

  it("mounts the RitualTimelineSlot with the projectId", () => {
    render(<RailShell projectId="proj-abc" />);
    expect(screen.getByTestId("ritual-timeline-host")).toBeInTheDocument();
    expect(screen.getByText(/timeline slot for proj-abc/)).toBeInTheDocument();
  });

  it("root element exposes data-rail-width-px='360' AND inline style width: 360px", () => {
    const { container } = render(<RailShell projectId="proj-abc" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute("data-rail-width-px")).toBe("360");
    expect(root.style.width).toBe("360px");
  });

  it("root element has data-testid='rail-shell' for e2e + integration probes", () => {
    render(<RailShell projectId="proj-abc" />);
    expect(screen.getByTestId("rail-shell")).toBeInTheDocument();
  });

  it("re-renders with a new projectId by passing it through to children", () => {
    const { rerender } = render(<RailShell projectId="p-1" />);
    expect(screen.getByText(/chat for p-1/)).toBeInTheDocument();
    rerender(<RailShell projectId="p-2" />);
    expect(screen.getByText(/chat for p-2/)).toBeInTheDocument();
    expect(screen.queryByText(/chat for p-1/)).not.toBeInTheDocument();
  });
});
