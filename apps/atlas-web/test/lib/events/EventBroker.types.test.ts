import { describe, it, expectTypeOf } from "vitest";
import type {
  EventBroker,
  RitualEvent,
  RitualEventType,
  PublishInput
} from "@/lib/events/EventBroker";

describe("EventBroker types (Plan E.0 contract)", () => {
  it("RitualEventType is the union from Plan E.0 spec + Plan P additions (gates + auto-fix) + Plan S.4 (canvas+designer) + Plan S.5 (visual quality) + Plan S.2 (researcher)", () => {
    type Expected =
      | "ritual.started" | "ritual.completed" | "ritual.escalated"
      | "ritual.escalation_requested"
      | "role.started" | "role.completed" | "role.failed" | "role.retrying"
      | "sandbox.provisioning" | "sandbox.provisioned"
      | "sandbox.apply.started" | "sandbox.apply.completed"
      // Plan P: gate events surface as their own RitualTimeline rows.
      | "security.started" | "security.completed" | "security.failed"
      | "accessibility.started" | "accessibility.completed" | "accessibility.failed"
      // Plan P: auto-fix events drive the meta-state counter.
      | "auto_fix.attempted" | "auto_fix.budget_exhausted" | "auto_fix.failed"
      // Plan S.5: visual-quality merge gate.
      | "visual_quality.started" | "visual_quality.passed" | "visual_quality.failed"
      | "visual_quality.skipped" | "visual_quality.completed" | "visual_quality.errored"
      // Plan S.2: researcher brief lifecycle.
      | "researcher.brief.started" | "researcher.brief.completed"
      | "researcher.brief.skipped" | "researcher.brief.failed"
      // Plan S.4: canvas + architect manifest + designer events.
      | "architect.canvas_manifest.emitted"
      | "designer.proposal.emitted" | "designer.proposal.failed"
      | "canvas.options.requested" | "canvas.option.selected"
      | "canvas.refinement.started" | "canvas.refinement.completed"
      // Plan SPU: Designer three-pass + AssetGenerator lifecycle.
      | "designer.draft.completed"
      | "designer.critique.started" | "designer.critique.completed"
      | "designer.revise.started" | "designer.revise.completed"
      | "asset.gen.started" | "asset.gen.completed" | "asset.gen.failed";
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
