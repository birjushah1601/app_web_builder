import type { EventSink, RitualEvent } from "@atlas/ritual-engine";

export interface SpecEventsRepoLike {
  append(projectId: string, event: { eventType: string; payload: unknown; actor: string | null }): Promise<unknown>;
}

export class SpecEventsSink implements EventSink {
  constructor(private readonly repo: SpecEventsRepoLike, private readonly projectId: string) {}
  async emit(event: RitualEvent): Promise<void> {
    await this.repo.append(this.projectId, {
      eventType: event.type,
      payload: {
        ritualId: event.ritualId,
        ts: event.ts,
        ...("payload" in event ? (event.payload as object) : {})
      },
      actor: null
    });
  }
}
