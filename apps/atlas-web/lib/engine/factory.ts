import { cache } from "react";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine } from "@atlas/ritual-engine";
import { ClerkPersonaPreferences } from "./persona-prefs";
import { SpecEventsSink } from "./event-sink";
import { OpenAICompatProvider } from "./openai-compat-provider";
import type { RitualEventType } from "@/lib/events/EventBroker";

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
  const { getEventBroker } = await import("@/lib/events/broker-singleton");
  const { isFeatureEnabled } = await import("@/lib/feature-flags");
  const { SpecEventsHydrator } = await import("./spec-events-hydrator");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // Plan H: share one SpecEventRepo instance between the engine's eventSink
  // (writes events) and the optional hydrator (reads them back) so both sides
  // see the same observability span tree.
  const specEventRepo = new SpecEventRepo(pool);
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
    const skillSubdirs = ["architect", "developer", "ship", "reviewer", "debugger", "security", "accessibility"];
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
    // Developer model selection. Defaults to deepPlanModel (sonnet-class)
    // for richest output, but the local proxy buffers non-streaming
    // requests and times out at 5min. Sonnet-tier requests for non-trivial
    // diffs routinely exceed that. Set ATLAS_LLM_DEVELOPER_MODEL=claude-haiku-4-5
    // (or any faster model) to escape the timeout in proxy-only setups.
    const developerModel = process.env.ATLAS_LLM_DEVELOPER_MODEL ?? deepPlanModel;
    roles.set(
      "developer",
      new DeveloperRole({
        anthropic: llm,
        google: llm,
        reviewer: llm,
        skills: skillRegistry,
        anthropicModel: developerModel,
        googleModel: developerModel,
        reviewerModel: developerModel,
        // Sequential mode is recommended when both slots point at the same
        // provider (e.g. local proxy) — avoids hammering one endpoint with
        // concurrent tool-use requests. Set ATLAS_DEVELOPER_SEQUENTIAL=true
        // to enable; defaults off (preserves parallel for multi-provider).
        parallelMode: process.env.ATLAS_DEVELOPER_SEQUENTIAL === "true" ? "sequential" : "parallel"
      })
    );

    // Plan I: register Security + Accessibility roles based on per-role
    // flags. Each role implements the Role interface from @atlas/conductor;
    // the engine dispatches them via forceRoleId after a successful
    // developer pass (per the postDeveloperChain option below).
    if (isFeatureEnabled("security-role")) {
      const { SecurityRole } = await import("@atlas/role-security");
      const securityModel = process.env.ATLAS_LLM_SECURITY_MODEL ?? deepPlanModel;
      roles.set("security", new SecurityRole({ llm, skills: skillRegistry, model: securityModel }));
    }
    if (isFeatureEnabled("a11y-role")) {
      const { AccessibilityRole } = await import("@atlas/role-accessibility");
      const a11yModel = process.env.ATLAS_LLM_A11Y_MODEL ?? deepPlanModel;
      roles.set("accessibility", new AccessibilityRole({ llm, skills: skillRegistry, model: a11yModel }));
    }
  }

  // Plan I: build the postDeveloperChain from the per-role flags. Order
  // is fixed: security first (more critical — secret-leak blocks the
  // whole branch), then accessibility (advisory-grade). Empty chain = no
  // post-developer dispatch, today's behavior.
  const postDeveloperChain: string[] = [];
  if (isFeatureEnabled("security-role")) postDeveloperChain.push("security");
  if (isFeatureEnabled("a11y-role"))     postDeveloperChain.push("accessibility");

  const conductor = new Conductor({
    classifier: { classify: async () => ({ roleId: "architect", confidence: 0.9 }) },
    roles,
    // Plan E.0: every Conductor checkpoint is now published to the
    // EventBroker (for live UI streaming) AND continues to flow to the
    // existing logging path. SpecEventRepo persistence lives on the
    // engine's `eventSink` (SpecEventsSink) below — independent path,
    // unchanged. Both publish + log are wrapped in Promise.allSettled so
    // a broker failure does not suppress logging and vice-versa. The
    // outer emit() never throws — Conductor expects fire-and-forget.
    checkpointSink: {
      emit: async (event) => {
        const broker = getEventBroker();
        const ritualType = mapCheckpointToRitualType(event.eventType);
        const publish = ritualType
          ? broker.publish({
              projectId,
              ritualId: event.ritualId,
              type: ritualType,
              payload: event.payload,
              ts: Date.parse(event.ts) || Date.now()
            })
          : Promise.resolve(null);

        const log = (async () => {
          if (event.eventType === "role.failed" || event.eventType === "ritual.escalated") {
            console.error(
              `[conductor] ${event.eventType}`,
              JSON.stringify(event.payload)
            );
          } else if (process.env.ATLAS_LOG_CHECKPOINTS) {
            console.log(`[conductor] ${event.eventType}`, JSON.stringify(event.payload));
          }
        })();

        const results = await Promise.allSettled([publish, log]);
        for (const r of results) {
          if (r.status === "rejected") {
            console.error("[conductor.checkpointSink] subscriber error:", r.reason);
          }
        }
      }
    },
    sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
  });

  // Plan H: when ATLAS_RITUAL_HYDRATION is on, the engine gets a hydrator
  // that reads spec_events back into a snapshot when getRitual misses the
  // in-memory map (process restart, cross-request access, etc.). When OFF,
  // hydrator stays undefined and getRitual returns undefined for unknown
  // ritualIds — today's behavior preserved.
  const hydrator = isFeatureEnabled("ritual-hydration")
    ? new SpecEventsHydrator(specEventRepo, projectId)
    : undefined;

  return new RitualEngine({
    conductor,
    eventSink: new SpecEventsSink(specEventRepo, projectId),
    personaPreferences: prefs,
    hydrator,
    postDeveloperChain,
    // Plan L: when ATLAS_FF_AUTO_FIX_LOOP is on, the engine auto-triggers
    // refine() in response to a chained gate failure. Capped at MAX_FIX_ATTEMPTS
    // per ritual lineage. Cross-flag dependency: refine() only works when
    // the postDeveloperChain has actually run, which itself is gated by
    // ATLAS_FF_SECURITY_ROLE / ATLAS_FF_A11Y_ROLE.
    autoFixLoopEnabled: isFeatureEnabled("auto-fix-loop"),
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

/** Map Conductor's checkpoint event types into the broker's RitualEventType
 *  union. Returns null for checkpoint types we don't surface to the live
 *  UI (e.g. dispatch.classified — internal routing detail). */
function mapCheckpointToRitualType(eventType: string): RitualEventType | null {
  switch (eventType) {
    case "ritual.started":          return "ritual.started";
    case "ritual.completed":        return "ritual.completed";
    case "ritual.escalated":        return "ritual.escalated";
    case "role.started":            return "role.started";
    case "role.completed":          return "role.completed";
    case "role.failed":             return "role.failed";
    case "role.retrying":           return "role.retrying";
    case "sandbox.provisioning":    return "sandbox.provisioning";
    case "sandbox.provisioned":     return "sandbox.provisioned";
    case "sandbox.apply.started":   return "sandbox.apply.started";
    case "sandbox.apply.completed": return "sandbox.apply.completed";
    // Plan P: forward gate + auto-fix events to the broker so the live UI
    // shows them. Without this mapping these events emit to the engine's
    // sink (Postgres) but never reach the broker → SSE → RitualTimeline path.
    case "ritual.escalation_requested": return "ritual.escalation_requested";
    case "security.started":        return "security.started";
    case "security.completed":      return "security.completed";
    case "security.failed":         return "security.failed";
    case "accessibility.started":   return "accessibility.started";
    case "accessibility.completed": return "accessibility.completed";
    case "accessibility.failed":    return "accessibility.failed";
    case "auto_fix.attempted":      return "auto_fix.attempted";
    case "auto_fix.budget_exhausted": return "auto_fix.budget_exhausted";
    case "auto_fix.failed":         return "auto_fix.failed";
    default:                        return null;
  }
}
