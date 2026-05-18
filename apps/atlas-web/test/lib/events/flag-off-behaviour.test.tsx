import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, renderHook } from "@testing-library/react";
import React from "react";
import {
  __resetEventBrokerForTesting,
  getEventBroker
} from "@/lib/events/broker-singleton";
import { EventSourceProvider, useEventStream } from "@/lib/events/EventSourceProvider";
import { isFeatureEnabled } from "@/lib/feature-flags";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onopen: unknown = null;
  onmessage: unknown = null;
  onerror: unknown = null;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() { this.closed = true; }
}

describe("flag OFF — behavioural lock (plan E.0 invariants)", () => {
  beforeEach(() => {
    __resetEventBrokerForTesting();
    MockEventSource.instances.length = 0;
  });

  it("isFeatureEnabled('live-events') is false when ATLAS_LIVE_EVENTS unset", () => {
    expect(isFeatureEnabled("live-events", { readEnv: () => undefined })).toBe(false);
  });

  it("broker is plumbed even with flag OFF — getEventBroker still returns a broker", () => {
    const b = getEventBroker();
    expect(b).toBeDefined();
    expect(typeof b.publish).toBe("function");
    expect(typeof b.subscribe).toBe("function");
  });

  it("publish still works with flag OFF — broker is infra, not UI-gated", async () => {
    const b = getEventBroker();
    const out = await b.publish({
      projectId: "p-flagoff",
      ritualId: "r-1",
      type: "ritual.started",
      payload: {},
      ts: 1
    });
    expect(out.id).toBe("p-flagoff:1");
  });

  it("EventSourceProvider with flagEnabled=false does NOT mount EventSource", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    render(<EventSourceProvider projectId="p-1" flagEnabled={false}>{null}</EventSourceProvider>);
    expect(MockEventSource.instances).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it("useEventStream() with flag OFF returns the disabled triple", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EventSourceProvider projectId="p-1" flagEnabled={false}>{children}</EventSourceProvider>
    );
    const { result } = renderHook(() => useEventStream(), { wrapper });
    expect(result.current).toEqual({
      events: [],
      status: "disabled",
      lastEventId: null
    });
  });
});
