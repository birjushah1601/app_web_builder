import { describe, it, expect, beforeEach } from "vitest";
import {
  getEventBroker,
  __resetEventBrokerForTesting
} from "@/lib/events/broker-singleton";
import { InMemoryEventBroker } from "@/lib/events/InMemoryEventBroker";

describe("broker-singleton", () => {
  beforeEach(() => __resetEventBrokerForTesting());

  it("returns the same instance across calls (process-wide singleton)", () => {
    const a = getEventBroker();
    const b = getEventBroker();
    expect(a).toBe(b);
  });

  it("default backend is InMemoryEventBroker", () => {
    const b = getEventBroker();
    expect(b).toBeInstanceOf(InMemoryEventBroker);
  });

  it("__resetEventBrokerForTesting forces a fresh instance on the next get", () => {
    const a = getEventBroker();
    __resetEventBrokerForTesting();
    const b = getEventBroker();
    expect(a).not.toBe(b);
  });
});
