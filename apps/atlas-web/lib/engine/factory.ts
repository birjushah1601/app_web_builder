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
  const { DeveloperRole } = await import("@atlas/role-developer");
  const { SkillRegistry, loadSkillsFromDir } = await import("@atlas/skill-runtime");
  const { resolve } = await import("node:path");
  const { applyDiff } = await import("@/lib/sandbox/apply-diff");
  const { createSandboxFsAdapter } = await import("@/lib/sandbox/sandbox-fs-adapter");
  const { getSandboxFactory } = await import("@/lib/sandbox/factory");

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
    // Developer role normally takes two distinct providers (Anthropic +
    // Google) for parallel dispatch + reviewer vote. In single-provider
    // setups (the local OpenAI-compat proxy is the only LLM), point both
    // slots at the same provider — the parallel dispatch becomes redundant
    // but the role still functions and the reviewer pass still picks a
    // winner via the same model.
    roles.set(
      "developer",
      new DeveloperRole({
        anthropic: llm,
        google: llm,
        reviewer: llm,
        skills: skillRegistry,
        anthropicModel: deepPlanModel,
        googleModel: deepPlanModel,
        reviewerModel: deepPlanModel,
        // Sequential mode is recommended when both slots point at the same
        // provider (e.g. local proxy) — avoids hammering one endpoint with
        // concurrent tool-use requests. Set ATLAS_DEVELOPER_SEQUENTIAL=true
        // to enable; defaults off (preserves parallel for multi-provider).
        parallelMode: process.env.ATLAS_DEVELOPER_SEQUENTIAL === "true" ? "sequential" : "parallel"
      })
    );
  }

  const conductor = new Conductor({
    classifier: { classify: async () => ({ roleId: "architect", confidence: 0.9 }) },
    roles,
    // Log every conductor checkpoint to stderr so role.failed payloads
    // (the actual underlying error message before retry) show up in the
    // dev server log. RitualEscalatedError otherwise swallows the cause.
    // TODO: replace with a real persistent sink when checkpoint storage lands.
    checkpointSink: {
      emit: async (event) => {
        if (event.eventType === "role.failed" || event.eventType === "ritual.escalated") {
          console.error(
            `[conductor] ${event.eventType}`,
            JSON.stringify(event.payload)
          );
        } else if (process.env.ATLAS_LOG_CHECKPOINTS) {
          console.log(`[conductor] ${event.eventType}`, JSON.stringify(event.payload));
        }
      }
    },
    sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
  });

  return new RitualEngine({
    conductor,
    eventSink: new SpecEventsSink(new SpecEventRepo(pool), projectId),
    personaPreferences: prefs,
    // Plan C: when the developer role lands a diff, the engine writes it
    // into the project's E2B sandbox. The applier resolves the live
    // sandbox session via SandboxFactory, reattaches to the running E2B
    // sandbox handle by ID (the SandboxSession only carries metadata,
    // not the SDK handle), wraps its `files` API in our adapter, and
    // delegates to applyDiff. Wrapped in try/catch so any failure
    // surfaces as a structured ApplyDiffResult — never throws into the
    // engine's start() loop.
    sandboxApplier: {
      apply: async (sandboxProjectId, diff) => {
        try {
          const session = await getSandboxFactory().getOrProvision(sandboxProjectId);
          const { Sandbox } = await import("@e2b/sdk");
          const sdk = await Sandbox.connect(session.record.sandboxId, {
            apiKey: process.env.E2B_API_KEY ?? ""
          });
          // E2B's `files.write` returns `Promise<WriteInfo>`; the adapter's
          // SandboxSessionLike expects `Promise<void>`. The return value is
          // unused by applyDiff — narrow via cast rather than wrap each call.
          const fs = createSandboxFsAdapter(sdk as never);
          return await applyDiff(fs, diff);
        } catch (err) {
          return {
            ok: false,
            parsed: 0,
            written: 0,
            failed: 0,
            skipped: 0,
            files: [],
            parseError: `sandbox unavailable: ${err instanceof Error ? err.message : String(err)}`
          };
        }
      }
    }
  });
});
