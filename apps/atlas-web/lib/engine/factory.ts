import { cache } from "react";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine } from "@atlas/ritual-engine";
import { ClerkPersonaPreferences } from "./persona-prefs";
import { SpecEventsSink } from "./event-sink";
import { OpenAICompatProvider } from "./openai-compat-provider";

/** Lazy + per-request cached. Real DB client + Conductor wiring happens here. */
export const getRitualEngine = cache(async (projectId: string): Promise<RitualEngine> => {
  const { Pool } = await import("pg");
  const { PreferencesRepo, SpecEventRepo } = await import("@atlas/spec-graph-data");
  const { currentUser } = await import("@clerk/nextjs/server");
  const { Registry } = await import("prom-client");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { AnthropicProvider, createProviderMetrics } = await import("@atlas/llm-provider");
  const { ArchitectRole, ARCHITECT_TRIAGE_MODEL, ARCHITECT_DEEP_PLAN_MODEL } = await import(
    "@atlas/role-architect"
  );
  const { SkillRegistry, loadSkillsFromDir } = await import("@atlas/skill-runtime");
  const { resolve } = await import("node:path");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prefs = new ClerkPersonaPreferences(
    new PreferencesRepo(pool),
    async () => (await currentUser()) as never
  );

  const roles = new Map<string, Role>();

  // Provider precedence:
  //   1. ATLAS_LLM_BASE_URL → OpenAI-compatible local proxy (Claude Code CLI etc.)
  //   2. ANTHROPIC_API_KEY → official Anthropic SDK
  //   3. Neither → architect role left unregistered, ritual.start will fail clearly
  type LlmProvider = import("@atlas/llm-provider").LLMProvider;
  let llm: LlmProvider | undefined;
  let triageModel: string | undefined;
  let deepPlanModel: string | undefined;

  if (process.env.ATLAS_LLM_BASE_URL) {
    llm = new OpenAICompatProvider({
      baseUrl: process.env.ATLAS_LLM_BASE_URL,
      apiKey: process.env.ATLAS_LLM_API_KEY ?? "sk-no-auth"
    });
    // Local CC CLI proxy uses Anthropic-rebadged model names like "claude-sonnet-4".
    triageModel = process.env.ATLAS_LLM_TRIAGE_MODEL ?? "claude-haiku-4-5";
    deepPlanModel = process.env.ATLAS_LLM_DEEP_MODEL ?? "claude-sonnet-4";
  } else if (process.env.ANTHROPIC_API_KEY) {
    const promRegistry = new Registry();
    const sdk = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    llm = new AnthropicProvider({ sdk, metrics: createProviderMetrics(promRegistry) });
    triageModel = ARCHITECT_TRIAGE_MODEL;
    deepPlanModel = ARCHITECT_DEEP_PLAN_MODEL;
  } else {
    console.warn(
      "[atlas-web] No LLM provider configured. Set ATLAS_LLM_BASE_URL (proxy) or ANTHROPIC_API_KEY. Ritual.start will fail with 'unknown role'."
    );
  }

  if (llm) {
    const skillsRoot = resolve(process.cwd(), "..", "..", "packages", "skill-library", "skills");
    const skillSubdirs = ["architect", "developer", "ship", "reviewer", "debugger"];
    const allSkills = (
      await Promise.all(skillSubdirs.map((sub) => loadSkillsFromDir(resolve(skillsRoot, sub))))
    ).flat();
    const skillRegistry = new SkillRegistry(allSkills);
    roles.set(
      "architect",
      new ArchitectRole({ llm, skills: skillRegistry, triageModel, deepPlanModel })
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
