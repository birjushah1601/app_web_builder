import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ProjectEventRow } from "@/lib/events/listProjectEvents";

// Mock the DB-backed reader so the test asserts on render output without
// needing a Postgres instance. The page is a Server Component that just
// awaits this fn and forwards to <EventsTable>; mocking the fn is enough.
const mockListProjectEvents = vi.fn<(projectId: string, limit?: number) => Promise<ProjectEventRow[]>>();

vi.mock("@/lib/events/listProjectEvents", () => ({
  listProjectEvents: (projectId: string, limit?: number) =>
    mockListProjectEvents(projectId, limit)
}));

// Server component reads `next/navigation` indirectly via the client
// EventsTable's useRouter; mock to a no-op router so the click handler
// can fire without a real Next.js context.
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn()
  })
}));

import EventsPage from "@/app/projects/[projectId]/events/page";

const sampleEvent = (overrides: Partial<ProjectEventRow> = {}): ProjectEventRow => ({
  seq: "1",
  ts: "2026-05-08T10:00:00.000Z",
  eventType: "ritual.started",
  role: "architect",
  payload: { ritualId: "r-1", intent: "ship the new pricing page" },
  ...overrides
});

describe("EventsPage (integration)", () => {
  beforeEach(() => {
    mockListProjectEvents.mockReset();
    mockRefresh.mockReset();
  });

  it("queries listProjectEvents with the projectId from params and a 200 limit", async () => {
    mockListProjectEvents.mockResolvedValueOnce([]);
    const tree = await EventsPage({ params: Promise.resolve({ projectId: "proj-42" }) });
    render(tree);
    expect(mockListProjectEvents).toHaveBeenCalledWith("proj-42", 200);
    expect(screen.getByTestId("events-page-header")).toHaveTextContent("proj-42");
  });

  it("renders an empty-state message when no events are returned", async () => {
    mockListProjectEvents.mockResolvedValueOnce([]);
    const tree = await EventsPage({ params: Promise.resolve({ projectId: "p" }) });
    render(tree);
    expect(screen.getByTestId("events-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("events-table")).not.toBeInTheDocument();
  });

  it("renders one row per event with seq/ts/event_type/role/summary columns", async () => {
    mockListProjectEvents.mockResolvedValueOnce([
      sampleEvent({ seq: "10", eventType: "role.started", role: "developer" }),
      sampleEvent({ seq: "9", eventType: "ritual.started", role: "architect" })
    ]);
    const tree = await EventsPage({ params: Promise.resolve({ projectId: "p" }) });
    render(tree);

    expect(screen.getByTestId("events-table")).toBeInTheDocument();

    // Header columns
    expect(screen.getByText("seq")).toBeInTheDocument();
    expect(screen.getByText("ts")).toBeInTheDocument();
    expect(screen.getByText("event_type")).toBeInTheDocument();
    expect(screen.getByText("role")).toBeInTheDocument();
    expect(screen.getByText("summary")).toBeInTheDocument();

    const row10 = screen.getByTestId("events-row-10");
    expect(within(row10).getByText("role.started")).toBeInTheDocument();
    expect(within(row10).getByText("developer")).toBeInTheDocument();

    const row9 = screen.getByTestId("events-row-9");
    expect(within(row9).getByText("ritual.started")).toBeInTheDocument();
    expect(within(row9).getByText("architect")).toBeInTheDocument();
  });

  it("truncates the summary to 80 chars + ellipsis", async () => {
    const longPayload = { intent: "x".repeat(500) };
    mockListProjectEvents.mockResolvedValueOnce([sampleEvent({ seq: "1", payload: longPayload })]);
    const tree = await EventsPage({ params: Promise.resolve({ projectId: "p" }) });
    render(tree);
    const row = screen.getByTestId("events-row-1");
    const summary = row.lastElementChild as HTMLElement;
    expect(summary.textContent ?? "").toMatch(/…$/);
    expect((summary.textContent ?? "").length).toBeLessThanOrEqual(81); // 80 + ellipsis
  });

  it("expands a row on click to reveal pretty-printed JSON; clicking again collapses", async () => {
    mockListProjectEvents.mockResolvedValueOnce([
      sampleEvent({ seq: "5", payload: { ritualId: "r-5", attempts: 3 } })
    ]);
    const tree = await EventsPage({ params: Promise.resolve({ projectId: "p" }) });
    render(tree);

    expect(screen.queryByTestId("events-row-payload-5")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("events-row-5"));
    const payloadCell = screen.getByTestId("events-row-payload-5");
    expect(payloadCell).toBeInTheDocument();
    // Pretty-printed JSON contains line breaks + the field names.
    expect(payloadCell.textContent ?? "").toContain('"ritualId"');
    expect(payloadCell.textContent ?? "").toContain('"r-5"');
    fireEvent.click(screen.getByTestId("events-row-5"));
    expect(screen.queryByTestId("events-row-payload-5")).not.toBeInTheDocument();
  });

  it("renders an em-dash placeholder when role is empty", async () => {
    mockListProjectEvents.mockResolvedValueOnce([sampleEvent({ seq: "1", role: "" })]);
    const tree = await EventsPage({ params: Promise.resolve({ projectId: "p" }) });
    render(tree);
    const row = screen.getByTestId("events-row-1");
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("Refresh button invokes router.refresh()", async () => {
    mockListProjectEvents.mockResolvedValueOnce([]);
    const tree = await EventsPage({ params: Promise.resolve({ projectId: "p" }) });
    render(tree);
    fireEvent.click(screen.getByTestId("events-refresh"));
    expect(mockRefresh).toHaveBeenCalledOnce();
  });
});
