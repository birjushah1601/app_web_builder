import { cache } from "react";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine } from "@atlas/ritual-engine";
import { ClerkPersonaPreferences } from "./persona-prefs";
import { SpecEventsSink } from "./event-sink";

/** Lazy + per-request cached. Real DB client + Conductor wiring happens here. */
export const getRitualEngine = cache(async (projectId: string): Promise<RitualEngine> => {
  const { Pool } = await import("pg");
  const { PreferencesRepo, SpecEventRepo } = await import("@atlas/spec-graph-data");
  const { currentUser } = await import("@clerk/nextjs/server");
  const { Registry } = await import("prom-client");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { AnthropicProvider, createProviderMetrics } = await import("@atlas/llm-provider");
  const { ArchitectRole } = await import("@atlas/role-architect");
  const { SkillRegistry, loadSkillsFromDir } = await import("@atlas/skill-runtime");
  const { resolve } = await import("node:path");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prefs = new ClerkPersonaPreferences(
    new PreferencesRepo(pool),
    async () => (await currentUser()) as never
  );

  const roles = new Map<string, Role>();
  if (process.env.ANTHROPIC_API_KEY) {
    const promRegistry = new Registry();
    const sdk = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(promRegistry) });

    // Architect composes brainstorm + spec-graph + runnable-plan, plus its own
    // skill set. Load enough subdirs to satisfy assembleArchitectPrompt.
    const skillsRoot = resolve(process.cwd(), "..", "..", "packages", "skill-library", "skills");
    const skillSubdirs = ["architect", "developer", "ship", "reviewer", "debugger"];
    const allSkills = (
      await Promise.all(skillSubdirs.map((sub) => loadSkillsFromDir(resolve(skillsRoot, sub))))
    ).flat();
    const skillRegistry = new SkillRegistry(allSkills);

    roles.set("architect", new ArchitectRole({ llm, skills: skillRegistry }));
  } else {
    console.warn(
      "[atlas-web] ANTHROPIC_API_KEY not set — architect role unregistered. Ritual.start will fail with 'unknown role'."
    );
  }

  const conductor = new Conductor({
    classifier: { classify: async () => ({ roleId: "architect", confidence: 0.9 }) },
    roles,
    checkpointSink: { emit: async () => {} },
    sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
  });

  return new RitualEngine({
    conductor,
    eventSink: new SpecEventsSink(new SpecEventRepo(pool), projectId),
    personaPreferences: prefs
  });
});
