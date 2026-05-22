import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, waitFor, act } from "@testing-library/react";
import React from "react";
import { EventSourceProvider, useEventStream } from "@/lib/events/EventSourceProvider";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  withCredentials: boolean;
  readyState = 0;
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
  closed = false;
  constructor(url: string | URL, opts?: EventSourceInit) {
    this.url = url.toString();
    this.withCredentials = opts?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }
  close() { this.closed = true; this.readyState = 2; }
  fireMessage(data: string, lastEventId?: string) {
    this.onmessage?.call(this as unknown as EventSource, new MessageEvent("message", { data, lastEventId }));
  }
  fireOpen() { this.readyState = 1; this.onopen?.call(this as unknown as EventSource, new Event("open")); }
  fireError() { this.onerror?.call(this as unknown as EventSource, new Event("error")); }
}

function withProvider(projectId: string, flagEnabled: boolean) {
  return ({ children }: { children: React.ReactNode }) => (
    <EventSourceProvider projectId={projectId} flagEnabled={flagEnabled}>
      {children}
    </EventSourceProvider>
  );
}

describe("EventSourceProvider — flag OFF", () => {
  beforeEach(() => { MockEventSource.instances.length = 0; });

  it("does NOT mount an EventSource when flagEnabled=false", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    render(<EventSourceProvider projectId="p-1" flagEnabled={false}>{null}</EventSourceProvider>);
    expect(MockEventSource.instances).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("useEventStream returns empty events + status='disabled' when flag is off", () => {
    const { result } = renderHook(() => useEventStream(), { wrapper: withProvider("p-1", false) });
    expect(result.current.events).toEqual([]);
    expect(result.current.status).toBe("disabled");
    expect(result.current.lastEventId).toBeNull();
  });
});

describe("EventSourceProvider — flag ON", () => {
  beforeEach(() => {
    MockEventSource.instances.length = 0;
    vi.stubGlobal("EventSource", MockEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("mounts an EventSource at /api/projects/<projectId>/events on render", () => {
    render(<EventSourceProvider projectId="p-1" flagEnabled={true}>{null}</EventSourceProvider>);
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]!.url).toContain("/api/projects/p-1/events");
  });

  it("re-mounts (closes old, opens new) when projectId changes", () => {
    const { rerender } = render(
      <EventSourceProvider projectId="p-1" flagEnabled={true}>{null}</EventSourceProvider>
    );
    expect(MockEventSource.instances).toHaveLength(1);
    const first = MockEventSource.instances[0]!;
    rerender(<EventSourceProvider projectId="p-2" flagEnabled={true}>{null}</EventSourceProvider>);
    expect(first.closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1]!.url).toContain("/api/projects/p-2/events");
  });

  it("appends events into useEventStream().events as messages arrive", async () => {
    const { result } = renderHook(() => useEventStream(), { wrapper: withProvider("p-1", true) });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    act(() => {
      MockEventSource.instances[0]!.fireOpen();
      MockEventSource.instances[0]!.fireMessage(
        JSON.stringify({ id: "p-1:1", projectId: "p-1", ritualId: "r-1", type: "ritual.started", payload: {}, ts: 1 }),
        "p-1:1"
      );
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]!.type).toBe("ritual.started");
    expect(result.current.lastEventId).toBe("p-1:1");
    expect(result.current.status).toBe("open");
  });

  it("sets status='error' on connection error event", async () => {
    const { result } = renderHook(() => useEventStream(), { wrapper: withProvider("p-1", true) });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    act(() => MockEventSource.instances[0]!.fireError());
    expect(result.current.status).toBe("error");
  });

  it("closes the EventSource on unmount (cleanup)", () => {
    const { unmount } = render(
      <EventSourceProvider projectId="p-1" flagEnabled={true}>{null}</EventSourceProvider>
    );
    expect(MockEventSource.instances[0]!.closed).toBe(false);
    unmount();
    expect(MockEventSource.instances[0]!.closed).toBe(true);
  });
});

describe("EventSourceProvider — initialEvents hydration (bug D17)", () => {
  beforeEach(() => {
    MockEventSource.instances.length = 0;
    vi.stubGlobal("EventSource", MockEventSource);
  });
  afterEach(() => vi.unstubAllGlobals());

  const seedEvents = [
    { id: "p-1:db-1", projectId: "p-1", ritualId: "r-1", type: "ritual.started" as const, payload: {}, ts: 1 },
    { id: "p-1:db-2", projectId: "p-1", ritualId: "r-1", type: "role.started" as const, payload: { roleId: "architect" }, ts: 2 }
  ];

  it("seeds useEventStream().events with initialEvents before SSE opens (flag ON)", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EventSourceProvider projectId="p-1" flagEnabled={true} initialEvents={seedEvents}>
        {children}
      </EventSourceProvider>
    );
    const { result } = renderHook(() => useEventStream(), { wrapper });
    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0]!.id).toBe("p-1:db-1");
    expect(result.current.events[1]!.id).toBe("p-1:db-2");
  });

  it("seeds useEventStream().events with initialEvents when flag is OFF (SSR-safe)", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EventSourceProvider projectId="p-1" flagEnabled={false} initialEvents={seedEvents}>
        {children}
      </EventSourceProvider>
    );
    const { result } = renderHook(() => useEventStream(), { wrapper });
    expect(result.current.events).toHaveLength(2);
    expect(result.current.status).toBe("disabled");
    // flag OFF must NOT open an EventSource even when initialEvents is set
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("skips SSE messages whose id matches an initialEvent (no duplication)", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EventSourceProvider projectId="p-1" flagEnabled={true} initialEvents={seedEvents}>
        {children}
      </EventSourceProvider>
    );
    const { result } = renderHook(() => useEventStream(), { wrapper });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    act(() => {
      MockEventSource.instances[0]!.fireOpen();
      // Replay the SAME id as an initialEvent — must NOT duplicate
      MockEventSource.instances[0]!.fireMessage(
        JSON.stringify({ id: "p-1:db-1", projectId: "p-1", ritualId: "r-1", type: "ritual.started", payload: {}, ts: 1 }),
        "p-1:db-1"
      );
      // A genuinely new event MUST still append
      MockEventSource.instances[0]!.fireMessage(
        JSON.stringify({ id: "p-1:99", projectId: "p-1", ritualId: "r-1", type: "role.completed", payload: { roleId: "architect" }, ts: 3 }),
        "p-1:99"
      );
    });
    expect(result.current.events).toHaveLength(3);
    const ids = result.current.events.map((e) => e.id);
    expect(ids).toEqual(["p-1:db-1", "p-1:db-2", "p-1:99"]);
  });

  it("also dedupes SSE messages that repeat (same id arrives twice on stream)", async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EventSourceProvider projectId="p-1" flagEnabled={true} initialEvents={[]}>
        {children}
      </EventSourceProvider>
    );
    const { result } = renderHook(() => useEventStream(), { wrapper });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    act(() => {
      MockEventSource.instances[0]!.fireOpen();
      MockEventSource.instances[0]!.fireMessage(
        JSON.stringify({ id: "p-1:1", projectId: "p-1", ritualId: "r-1", type: "ritual.started", payload: {}, ts: 1 }),
        "p-1:1"
      );
      MockEventSource.instances[0]!.fireMessage(
        JSON.stringify({ id: "p-1:1", projectId: "p-1", ritualId: "r-1", type: "ritual.started", payload: {}, ts: 1 }),
        "p-1:1"
      );
    });
    expect(result.current.events).toHaveLength(1);
  });
});
