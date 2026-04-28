import { describe, it, expectTypeOf } from "vitest";
import type {
  EventBroker,
  RitualEvent,
  RitualEventType,
  PublishInput
} from "@/lib/events/EventBroker";

describe("EventBroker types (Plan E.0 contract)", () => {
  it("RitualEventType is the exact 11-value union from the spec", () => {
    type Expected =
      | "ritual.started" | "ritual.completed" | "ritual.escalated"
      | "role.started" | "role.completed" | "role.failed" | "role.retrying"
      | "sandbox.provisioning" | "sandbox.provisioned"
      | "sandbox.apply.started" | "sandbox.apply.completed";
    expectTypeOf<RitualEventType>().toEqualTypeOf<Expected>();
  });

  it("RitualEvent has id, projectId, ritualId, type, payload, ts", () => {
    expectTypeOf<RitualEvent>().toEqualTypeOf<{
      id: string;
      projectId: string;
      ritualId: string;
      type: RitualEventType;
      payload: Record<string, unknown>;
      ts: number;
    }>();
  });

  it("PublishInput is RitualEvent with id omitted (broker assigns)", () => {
    expectTypeOf<PublishInput>().toEqualTypeOf<Omit<RitualEvent, "id">>();
  });

  it("EventBroker.publish returns Promise<RitualEvent> (the assigned event)", () => {
    expectTypeOf<EventBroker["publish"]>().parameters.toEqualTypeOf<[PublishInput]>();
    expectTypeOf<EventBroker["publish"]>().returns.toEqualTypeOf<Promise<RitualEvent>>();
  });

  it("EventBroker.subscribe returns AsyncIterable<RitualEvent> with optional sinceEventId + signal", () => {
    type SubscribeOpts = { sinceEventId?: string; signal?: AbortSignal };
    expectTypeOf<EventBroker["subscribe"]>().parameters.toEqualTypeOf<[string, SubscribeOpts?]>();
    expectTypeOf<EventBroker["subscribe"]>().returns.toEqualTypeOf<AsyncIterable<RitualEvent>>();
  });
});
