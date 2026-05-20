import { describe, it, expect, vi } from "vitest";
import { MessageBus } from "../src/messaging.js";

describe("MessageBus", () => {
  it("delivers a published message to all subscribers of the topic", async () => {
    const bus = new MessageBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe("role.completed", h1);
    bus.subscribe("role.completed", h2);
    await bus.publish("role.completed", { roleId: "developer", diffHash: "abc" });
    expect(h1).toHaveBeenCalledWith({ roleId: "developer", diffHash: "abc" });
    expect(h2).toHaveBeenCalledWith({ roleId: "developer", diffHash: "abc" });
  });

  it("does not deliver to other topics", async () => {
    const bus = new MessageBus();
    const h = vi.fn();
    bus.subscribe("role.failed", h);
    await bus.publish("role.completed", { x: 1 });
    expect(h).not.toHaveBeenCalled();
  });

  it("unsubscribe stops delivery", async () => {
    const bus = new MessageBus();
    const h = vi.fn();
    const unsub = bus.subscribe("t", h);
    await bus.publish("t", 1);
    unsub();
    await bus.publish("t", 2);
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith(1);
  });

  it("handler errors do not prevent other handlers from running", async () => {
    const bus = new MessageBus();
    const good = vi.fn();
    bus.subscribe("t", () => { throw new Error("h1 fail"); });
    bus.subscribe("t", good);
    await bus.publish("t", 42);
    expect(good).toHaveBeenCalledWith(42);
  });
});
