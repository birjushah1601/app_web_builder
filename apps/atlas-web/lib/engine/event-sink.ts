import type { EventSink, RitualEvent } from "@atlas/ritual-engine";
import type { EventBroker, RitualEventType } from "@/lib/events/EventBroker";

export interface SpecEventsRepoLike {
  append(projectId: string, event: { eventType: string; payload: unknown; actor: string | null }): Promise<unknown>;
}

/**
 * SpecEventsSink — persists every engine-emitted RitualEvent to spec_events
 * (durable history) AND, when a broker is supplied, also publishes the
 * event to the in-process EventBroker so the SSE stream picks it up.
 *
 * Plan S.4 wiring: the engine emits canvas.* / designer.* / architect.canvas_manifest.emitted
 * via this sink. Without the broker side-channel they would only ever
 * land in the DB, never reaching the live UI.
 *
 * Both side effects are wrapped so a broker failure does not suppress
 * the DB write (and vice-versa) — neither is allowed to throw out of
 * emit() because the engine treats event emission as fire-and-forget.
 */
export class SpecEventsSink implements EventSink {
  constructor(
    private readonly repo: SpecEventsRepoLike,
    private readonly projectId: string,
    /** Optional broker side-channel. When provided, every event the engine
     *  emits whose type is in the broker's RitualEventType union is also
     *  published to the broker. Unrecognized event types are silently
     *  skipped on the broker path (still persisted via the repo). */
    private readonly broker?: EventBroker
  ) {}

  async emit(event: RitualEvent): Promise<void> {
    const repoP = this.repo.append(this.projectId, {
      eventType: event.type,
      payload: {
        ritualId: event.ritualId,
        ts: event.ts,
        ...("payload" in event ? (event.payload as object) : {})
      },
      actor: null
    });

    const brokerP = this.broker
      ? this.broker
          .publish({
            projectId: this.projectId,
            ritualId: event.ritualId,
            type: event.type as RitualEventType,
            payload: ("payload" in event ? (event.payload as Record<string, unknown>) : {}) ?? {},
            ts: Date.parse(event.ts) || Date.now()
          })
          .catch((err: unknown) => {
            console.error("[atlas-web] SpecEventsSink broker publish failed", err);
            return null;
          })
      : Promise.resolve(null);

    const results = await Promise.allSettled([repoP, brokerP]);
    for (const r of results) {
      if (r.status === "rejected") {
        console.error("[atlas-web] SpecEventsSink emit error:", r.reason);
      }
    }
  }
}
