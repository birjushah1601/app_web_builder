import { cache } from "react";
import { Conductor } from "@atlas/conductor";
import { RitualEngine } from "@atlas/ritual-engine";
import { ClerkPersonaPreferences } from "./persona-prefs";
import { SpecEventsSink } from "./event-sink";

/** Lazy + per-request cached. Real DB client + Conductor wiring happens here. */
export const getRitualEngine = cache(async (projectId: string): Promise<RitualEngine> => {
  const { Pool } = await import("pg");
  const { PreferencesRepo, SpecEventRepo } = await import("@atlas/spec-graph-data");
  const { currentUser } = await import("@clerk/nextjs/server");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prefs = new ClerkPersonaPreferences(
    new PreferencesRepo(pool),
    async (_userId) => (await currentUser()) as never
  );

  // Conductor — for E.2 we instantiate with empty roles; D.3-D.5 wire real ones in their own plans.
  const conductor = new Conductor({
    classifier: { classify: async () => ({ roleId: "architect", confidence: 0.9 }) },
    roles: new Map(),
    checkpointSink: { emit: async () => {} },
    sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
  });

  return new RitualEngine({
    conductor,
    eventSink: new SpecEventsSink(new SpecEventRepo(pool), projectId),
    personaPreferences: prefs
  });
});
