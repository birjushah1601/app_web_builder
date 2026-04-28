import {
  replayEventsToSnapshot,
  type RitualHydrator,
  type RitualSnapshot,
  type SpecEventRowLike
} from "@atlas/ritual-engine";

interface SpecEventRepoLike {
  listByRitual(projectId: string, ritualId: string, opts?: { limit?: number }): Promise<SpecEventRowLike[]>;
}

/**
 * SpecEventsHydrator — adapts SpecEventRepo (Postgres) into the
 * @atlas/ritual-engine RitualHydrator interface.
 *
 * Failure mode: any error from listByRitual is logged and converted to
 * `null` so the engine treats it as "ritual unknown" rather than crashing.
 * See Plan H Design Decision 6.
 */
export class SpecEventsHydrator implements RitualHydrator {
  constructor(
    private readonly repo: SpecEventRepoLike,
    private readonly projectId: string
  ) {}

  async hydrate(ritualId: string): Promise<RitualSnapshot | null> {
    try {
      const rows = await this.repo.listByRitual(this.projectId, ritualId);
      return replayEventsToSnapshot(rows);
    } catch (err) {
      console.error(
        "[atlas-web] SpecEventsHydrator.hydrate failed; treating as unknown ritualId",
        { ritualId, err }
      );
      return null;
    }
  }
}
