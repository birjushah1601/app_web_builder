import { cache } from "react";
import { Conductor, type Role } from "@atlas/conductor";
import { RitualEngine } from "@atlas/ritual-engine";
import { ClerkPersonaPreferences } from "./persona-prefs";
import { SpecEventsSink } from "./event-sink";
import { OpenAICompatProvider } from "./openai-compat-provider";
import type { RitualEventType } from "@/lib/events/EventBroker";

// Pin the per-project engine instance to globalThis. React's cache() is
// per-request, but the engine's in-memory ritual records (developerOutput.diff,
// canvas-pause registrations, sandbox-apply state) need to survive across
// requests — otherwise a Server Action like redeployPreview gets a fresh
// engine with an empty rituals Map and the diff is lost. The hydrator pulls
// what it can from spec_events, but developer diffs are not persisted there.
// Same pattern as broker-singleton.ts and canvas-pause-singleton.ts.
const ENGINE_KEY = "__atlas_ritual_engines__";
type WithEngines = { [ENGINE_KEY]?: Map<string, RitualEngine> };

function getEngineRegistry(): Map<string, RitualEngine> {
  const g = globalThis as unknown as WithEngines;
  if (!g[ENGINE_KEY]) g[ENGINE_KEY] = new Map();
  return g[ENGINE_KEY];
}

/** Lazy + per-process cached. Real DB client + Conductor wiring happens here.
 *  The outer cache() preserves per-request memoization (so multiple Server
 *  Action calls in one render don't double-construct); the inner registry
 *  pins the actual engine instance per Node process so cross-request state
 *  (in-flight rituals, canvas pauses, developer diffs) is shared. */
export const getRitualEngine = cache(async (projectId: string): Promise<RitualEngine> => {
  const registry = getEngineRegistry();
  const cached = registry.get(projectId);
  if (cached) return cached;
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
  const { getSandboxFactory, resolveTemplateForRitual } = await import("@/lib/sandbox/factory");
  const { getEventBroker } = await import("@/lib/events/broker-singleton");
  const { isFeatureEnabled } = await import("@/lib/feature-flags");
  const { SpecEventsHydrator } = await import("./spec-events-hydrator");
  const { getCanvasPauseRegistry } = await import("./canvas-pause-singleton");

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

  // Plan Q: demo-mode short-circuit. When ATLAS_FF_DEMO_MODE=true (env)
  // OR the per-request `atlas-demo-mode` cookie is set to "true", swap
  // architect + developer for canned-response stand-ins so the full UI
  // flow runs end-to-end without any LLM call. Cookie wins over env, so a
  // browser session can flip demo mode on/off without redeploying. Plan I
  // gates (security/a11y) still run if their flags are on — they hit the
  // real LLM via the existing role packages, so demo-mode + gate flags
  // both on means gates still cost a small amount per ritual. To make
  // demo-mode FULLY token-free, also leave ATLAS_FF_SECURITY_ROLE /
  // ATLAS_FF_A11Y_ROLE off.
  const { isFeatureEnabledForRequest } = await import("@/lib/feature-flags-server");
  const demoModeOn = await isFeatureEnabledForRequest("demo-mode");
  if (demoModeOn) {
    const { DemoArchitectRole } = await import("./demo-mode/demo-architect-role");
    const { DemoDeveloperRole } = await import("./demo-mode/demo-developer-role");
    roles.set("architect", new DemoArchitectRole());
    roles.set("developer", new DemoDeveloperRole());
    console.warn("[atlas-web] DEMO MODE active — architect + developer return canned outputs (no LLM cost). Unset ATLAS_FF_DEMO_MODE for real LLM flow.");
  } else if (llm) {
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
    // Plan T.1 — resolve the per-ritual sandbox template at engine
    // construction time. Without an architect snapshot in hand we pass
    // artifactKind=undefined; resolveTemplateForRitual then honors
    // ATLAS_DEFAULT_SANDBOX_TEMPLATE (per-project pin) > ATLAS_FF_MULTI_STACK
    // routing > the atlas-next-ts-v2 default. The resolved name flows into
    // DeveloperRole.targetTemplate so the per-template prompt fragment from
    // sandbox-context-registry is selected for both Anthropic and Google
    // passes.
    const developerTargetTemplate = resolveTemplateForRitual({ artifactKind: undefined });
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
        parallelMode: process.env.ATLAS_DEVELOPER_SEQUENTIAL === "true" ? "sequential" : "parallel",
        targetTemplate: developerTargetTemplate
      })
    );

    // Plan S.2 + S.3: register Researcher + Designer roles when their flags
    // are on. The engine's canvas flow (canvasFlowEnabled) dispatches
    // researcher → designer → pause-on-canvas.options.requested. Without
    // registration here the conductor logs "unknown-role" for both and
    // jumps straight from architect to developer (no design context).
    if (isFeatureEnabled("researcher")) {
      const { getResearcherRole } = await import("@/lib/llm/factory");
      const researcherRole = await getResearcherRole();
      if (researcherRole) roles.set("researcher", researcherRole as unknown as Role);
    }
    if (isFeatureEnabled("designer")) {
      const { getDesignerRole } = await import("@/lib/llm/factory");
      const designerRole = await getDesignerRole();
      if (designerRole) roles.set("designer", designerRole as unknown as Role);
    }

    // Plan SPU — register AssetGenerator when ATLAS_FF_ASSET_GEN=true. The
    // engine's canvas flow (engine.ts) dispatches it after the canvas pause
    // resolves and folds the resulting assetManifest into the developer's
    // priorArtifact. Without registration the engine's `hasRole()` check
    // returns false and the dispatch branch is silently skipped. cacheImage
    // is the sha256-keyed local cache from Slice C — gpt-image-1 outputs are
    // expensive, so de-duping by content hash is the easy win. The two
    // image-source flags (hero-ai-image / hero-unsplash) gate the
    // AssetGenerator's own internal branches; this flag only gates whether
    // the role is registered at all.
    if (isFeatureEnabled("asset-gen")) {
      const { AssetGeneratorRole } = await import("@atlas/role-asset-generator");
      const { cacheImage } = await import("@/lib/assets/image-cache");
      roles.set(
        "asset-generator",
        new AssetGeneratorRole({
          ...(process.env.OPENAI_API_KEY ? { openaiKey: process.env.OPENAI_API_KEY } : {}),
          ...(process.env.UNSPLASH_ACCESS_KEY ? { unsplashKey: process.env.UNSPLASH_ACCESS_KEY } : {}),
          writeImage: cacheImage
        }) as unknown as Role
      );
    }

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

    // Plan L0: Build gate. Constructed only when ATLAS_FF_BUILD_GATE=true.
    // MUST be prepended (not appended) to postDeveloperChain — running the
    // compiler first short-circuits LLM gate work on uncompilable code.
    //
    // Two contract differences from gate-visual-quality (mirrored above):
    //   - SandboxExec.runCommand takes {cmd, timeoutMs}, returns
    //     {exitCode, stdout, stderr, timedOut}.
    //   - template is captured at engine-factory construction (best-effort).
    //     If the sandbox's actual template changes mid-conversation the role
    //     will return errorKind:"unsupported_stack" at dispatch — acceptable
    //     for v1; the auto-fix loop surfaces the issue.
    if (isFeatureEnabled("build-gate")) {
      const { BuildGateRole } = await import("@atlas/gate-build");

      const buildExec: import("@atlas/gate-build").SandboxExec = {
        runCommand: async ({ cmd, timeoutMs }) => {
          const session = await getSandboxFactory().getOrProvision(projectId);
          const { Sandbox } = await import("@e2b/sdk");
          const sdk = await Sandbox.connect(session.record.sandboxId, { apiKey: process.env.E2B_API_KEY ?? "" });
          try {
            // E2B SDK's commands.run accepts an options object; we pass timeoutMs.
            // (Type-shape varies across SDK versions; assert through unknown to
            // match the existing VisualQuality adapter's idiom in this file.)
            const result = await (sdk as unknown as {
              commands: {
                run: (cmd: string, opts?: { timeoutMs?: number; background?: false }) => Promise<{ stdout: string; stderr: string; exitCode: number }>
              }
            }).commands.run(cmd, { timeoutMs });
            return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, timedOut: false };
          } catch (err) {
            // E2B v2.5 throws CommandExitError (extends SandboxError) when a
            // command exits non-zero — including the legitimate case of
            // tsc/pyright finding compile errors. The error carries the real
            // exitCode/stdout/stderr; surface them as a normal result so
            // BuildGateRole parses them as errorKind:"compile" or "type"
            // rather than misrouting as "sandbox_unreachable".
            const name = (err as { name?: string })?.name;
            if (name === "CommandExitError") {
              const e = err as { exitCode?: number; stdout?: string; stderr?: string };
              return {
                exitCode: typeof e.exitCode === "number" ? e.exitCode : 1,
                stdout: e.stdout ?? "",
                stderr: e.stderr ?? "",
                timedOut: false
              };
            }
            // TimeoutError → structured timeout (errorKind:"timeout").
            if (name === "TimeoutError") {
              return { exitCode: 124, stdout: "", stderr: `Command exceeded ${timeoutMs}ms`, timedOut: true };
            }
            // True infra failure (network, sandbox gone, auth, etc.) → let
            // BuildGateRole emit errorKind:"sandbox_unreachable".
            throw err;
          }
        }
      };

      // Best-effort template capture. .catch(() => null) mirrors VQ's pattern.
      const buildGateSession = await getSandboxFactory().getOrProvision(projectId).catch(() => null);
      const template = buildGateSession?.record?.templateId ?? "atlas-next-ts-v2";

      roles.set("build-gate", new BuildGateRole({ template, exec: buildExec }));
    }

    // T15: register SchemaArchitectRole when ATLAS_FF_SCHEMA_ARCHITECT=true.
    // Dispatch is based on artifactKind at ritual time; both schema-architect
    // and designer can coexist in the roles map without conflict.
    if (isFeatureEnabled("schema-architect")) {
      const { SchemaArchitectRole } = await import("@atlas/role-schema-architect");
      roles.set(
        "schema-architect",
        new SchemaArchitectRole({ llm }) as unknown as Role
      );
    }

    // Plan S.5: Visual-Quality merge gate. Constructed only when the flag
    // is on; appended to postDeveloperChain after Security + A11y. The role
    // needs `exec` (E2B process API) and `previewUrl` — both resolved
    // lazily inside a `runCommand` adapter so a stale sandbox at engine
    // construction time still yields a working role at dispatch time.
    if (isFeatureEnabled("visual-quality-gate")) {
      const { VisualQualityRole } = await import("@atlas/gate-visual-quality");
      const vqModel = process.env.ATLAS_VQ_GATE_MODEL ?? deepPlanModel;

      // Lazy SandboxExec adapter — connects to the live E2B sandbox per
      // call. Avoids capturing a sandbox handle at construction time
      // (handles can go stale via E2B's idle TTL eviction; getSandboxFactory
      // already handles re-provision on demand).
      const lazyExec = {
        runCommand: async (cmd: string) => {
          const session = await getSandboxFactory().getOrProvision(projectId);
          const { Sandbox } = await import("@e2b/sdk");
          const sdk = await Sandbox.connect(session.record.sandboxId, {
            apiKey: process.env.E2B_API_KEY ?? ""
          });
          // E2B SDK v2.5+ Commands API: sdk.commands.run(cmd) returns
          // { stdout, stderr, exitCode } when background is false (default).
          // The role's SandboxExec contract maps 1:1.
          const result = await (sdk as unknown as { commands: { run: (cmd: string, opts?: { background?: false }) => Promise<{ stdout: string; stderr: string; exitCode: number }> } }).commands.run(cmd);
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
        }
      };

      // Lazy previewUrl resolver — captured at construction is fine
      // because the URL is stable for the lifetime of a sandbox; if the
      // sandbox was re-provisioned the url may differ but the role will
      // still hit the live preview surface served at port 3000.
      const session = await getSandboxFactory().getOrProvision(projectId).catch(() => null);
      const previewUrl = session?.previewUrl ?? "";

      roles.set(
        "visual-quality",
        new VisualQualityRole({
          llm,
          skills: skillRegistry,
          exec: lazyExec,
          previewUrl,
          ...(vqModel ? { model: vqModel } : {})
        })
      );
    }
  }

  // Plan I + S.5: build the postDeveloperChain from the per-role flags.
  // Order is fixed: security first (more critical — secret-leak blocks the
  // whole branch), then accessibility (advisory-grade), then visual-quality
  // (taste-driven; runs last so it sees the final-state preview after any
  // upstream gate fixes). Empty chain = no post-developer dispatch.
  const postDeveloperChain: string[] = [];
  if (isFeatureEnabled("build-gate"))          postDeveloperChain.push("build-gate");
  if (isFeatureEnabled("security-role"))       postDeveloperChain.push("security");
  if (isFeatureEnabled("a11y-role"))           postDeveloperChain.push("accessibility");
  if (isFeatureEnabled("visual-quality-gate")) postDeveloperChain.push("visual-quality");

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
        const mapped = mapCheckpointToBrokerEvent(event.eventType, event.payload);
        const publish = mapped
          ? broker.publish({
              projectId,
              ritualId: event.ritualId,
              type: mapped.type,
              payload: mapped.payload,
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

  // Plan S.4: when the canvas-v1 + designer flags are on, the engine runs the
  // canvas pause flow — emits canvas.options.requested then awaits a
  // selection on the process-singleton CanvasPauseRegistry. The Server
  // Action selectDesignDirection resolves against that same singleton.
  // Both flags must be on (registry attaches only when both are enabled);
  // either off → engine skips the pause and chains straight into developer.
  const canvasFlowEnabled = isFeatureEnabled("canvas-v1") && isFeatureEnabled("designer");
  const canvasPauseRegistry = canvasFlowEnabled ? getCanvasPauseRegistry() : undefined;

  const engine = new RitualEngine({
    conductor,
    // SpecEventsSink wraps the broker singleton so canvas/designer events the
    // engine emits via this.emit() are also published to the SSE stream
    // (otherwise they'd be DB-only and the new client hooks would never see them).
    eventSink: new SpecEventsSink(specEventRepo, projectId, getEventBroker()),
    personaPreferences: prefs,
    hydrator,
    postDeveloperChain,
    canvasFlowEnabled,
    ...(canvasPauseRegistry ? { canvasPauseRegistry } : {}),
    // Plan PFP gap-fix: 30s pause (was 30min default) so first-time users
    // who don't know to click a design card aren't stuck — the engine
    // auto-picks Designer's `recommended` direction after 30s and proceeds
    // to Developer + sandbox apply + preview. Users who DO click within
    // 30s get their choice. Operators can tune via ATLAS_CANVAS_PAUSE_MS.
    canvasPauseTimeoutMs: Number(process.env.ATLAS_CANVAS_PAUSE_MS ?? 30_000),
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
        // Single-retry loop. E2B auto-pauses sandboxes after idle TTL
        // (~5 min); the in-memory cache then points at a sandbox that
        // returns "Paused sandbox <id> not found" on Sandbox.connect().
        // On that specific failure we evict and re-provision once;
        // anything else propagates as a parseError.
        const tryApply = async (): Promise<Awaited<ReturnType<typeof applyDiff>>> => {
          const session = await getSandboxFactory().getOrProvision(sandboxProjectId);
          const { Sandbox } = await import("@e2b/sdk");
          const sdk = await Sandbox.connect(session.record.sandboxId, {
            apiKey: process.env.E2B_API_KEY ?? ""
          });
          // E2B's `files.write` returns `Promise<WriteInfo>`; the adapter's
          // SandboxSessionLike expects `Promise<void>`. The return value is
          // unused by applyDiff — narrow via cast rather than wrap each call.
          const fs = createSandboxFsAdapter(sdk as never);
          const result = await applyDiff(fs, diff);
          // Plan SPU follow-up — copy AI-generated hero images from
          // .next/cache/atlas-assets/ into the sandbox's public folder so the
          // developer's verbatim `<img src="/atlas-assets/<sha>.jpg" />`
          // references actually resolve to the bytes inside the sandbox.
          // Best-effort; failures here don't fail the apply (you'd just see
          // broken images in the iframe).
          try {
            const { syncAtlasAssetsToSandbox } = await import("@/lib/sandbox/sync-atlas-assets");
            const sync = await syncAtlasAssetsToSandbox(sdk as never);
            if (sync.copied > 0 || sync.failed > 0) {
              console.log(`[atlas-assets-sync] copied=${sync.copied} failed=${sync.failed}`);
            }
          } catch (err) {
            console.warn(`[atlas-assets-sync] skipped:`, err instanceof Error ? err.message : String(err));
          }
          return result;
        };

        const isStaleSandboxError = (err: unknown): boolean => {
          const msg = err instanceof Error ? err.message : String(err);
          return /paused\s+sandbox.*not\s+found|sandbox\s+not\s+found|sandbox.*was\s+killed/i.test(msg);
        };

        try {
          return await tryApply();
        } catch (err) {
          if (isStaleSandboxError(err)) {
            console.warn(
              `[atlas-web] sandbox stale for project ${sandboxProjectId}, evicting + reprovisioning:`,
              err instanceof Error ? err.message : String(err)
            );
            getSandboxFactory().evict(sandboxProjectId);
            try {
              return await tryApply();
            } catch (retryErr) {
              return {
                ok: false,
                parsed: 0,
                written: 0,
                failed: 0,
                skipped: 0,
                files: [],
                parseError: `sandbox unavailable after reprovision: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`
              };
            }
          }
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

  registry.set(projectId, engine);
  return engine;
});

/** Map a Conductor checkpoint event into a `(type, payload)` pair the
 *  broker can publish. Returns null when the event isn't surfaced on the
 *  live UI (e.g. dispatch.classified — internal routing detail).
 *
 *  Many role-internal events get translated into the broker's flat
 *  role.started/completed/failed types so the existing reducer can fold
 *  them without learning every role's internal event vocabulary. The
 *  reducer's phaseFromPayload reads either `role` or `roleId`; we set
 *  `role` here so the rail rows (architect, developer) light up. */
function mapCheckpointToBrokerEvent(
  eventType: string,
  payload: Record<string, unknown>
): { type: RitualEventType; payload: Record<string, unknown> } | null {
  switch (eventType) {
    // Ritual-level lifecycle
    case "ritual.started":          return { type: "ritual.started",          payload };
    case "ritual.completed":        return { type: "ritual.completed",        payload };
    case "ritual.escalated":        return { type: "ritual.escalated",        payload };
    case "ritual.escalation_requested": return { type: "ritual.escalation_requested", payload };

    // Conductor-emitted fallback (used by some retry paths)
    case "role.started":            return { type: "role.started",            payload };
    case "role.completed":          return { type: "role.completed",          payload };
    case "role.failed":             return { type: "role.failed",             payload };
    case "role.retrying":           return { type: "role.retrying",           payload };

    // Architect role internal events → translate to role.* with role=architect.
    // The conductor doesn't emit role.started/completed itself for the
    // architect; it just forwards the role's own events. Without this
    // translation the rail's architect row never leaves "pending".
    case "architect.pass1.started":   return { type: "role.started",   payload: { ...payload, role: "architect" } };
    case "architect.pass2.completed": return { type: "role.completed", payload: { ...payload, role: "architect" } };
    case "architect.pass1.failed":
    case "architect.pass2.failed":    return { type: "role.failed",    payload: { ...payload, role: "architect" } };
    // pass1.completed fires for BOTH the success path (pass2 will follow,
    // so don't emit role.completed yet — pass2's mapping handles it) and
    // the triage-pause path (passed=false → role pauses with a question,
    // no pass2 follows). For the pause case we MUST emit role.completed
    // so the architect rail row's spinner stops; the triage card renders
    // off the separate architect.triage.needs_input event below.
    case "architect.pass1.completed":
      return payload?.passed === false
        ? { type: "role.completed", payload: { ...payload, role: "architect" } }
        : null;
    // Triage pause: the conductor's architect role asks a clarifying
    // question and stops. The UI consumes this to render the question
    // card (e.g. "What payment processor?"); without forwarding, the
    // canvas hangs forever on the architect spinner with no question
    // visible — observed during T16 smoke 2026-05-19.
    case "architect.triage.needs_input":
      return { type: "architect.triage.needs_input", payload };

    // Plan L0 — Build-gate events. Forward all four lifecycle events so
    // the rail can render a build-gate row alongside security/a11y/VQ
    // and the ritual.escalation_requested handler can react to .completed.
    case "build-gate.started":    return { type: "build-gate.started",   payload };
    case "build-gate.passed":     return { type: "build-gate.passed",    payload };
    case "build-gate.failed":     return { type: "build-gate.failed",    payload };
    case "build-gate.completed":  return { type: "build-gate.completed", payload };

    // Developer role internal events → translate to role.* with role=developer.
    // developer.dispatch.started fires when the developer role begins; the
    // role emits developer.completed at the end (winner picked). The
    // *.failed variants light the row red.
    case "developer.dispatch.started": return { type: "role.started",   payload: { ...payload, role: "developer" } };
    case "developer.completed":        return { type: "role.completed", payload: { ...payload, role: "developer" } };
    case "developer.both_failed":
    case "developer.dispatch.failed":  return { type: "role.failed",    payload: { ...payload, role: "developer" } };

    // Sandbox events
    case "sandbox.provisioning":    return { type: "sandbox.provisioning",    payload };
    case "sandbox.provisioned":     return { type: "sandbox.provisioned",     payload };
    case "sandbox.apply.started":   return { type: "sandbox.apply.started",   payload };
    case "sandbox.apply.completed": return { type: "sandbox.apply.completed", payload };

    // Plan I gate events
    case "security.started":        return { type: "security.started",        payload };
    case "security.completed":      return { type: "security.completed",      payload };
    case "security.failed":         return { type: "security.failed",         payload };
    case "accessibility.started":   return { type: "accessibility.started",   payload };
    case "accessibility.completed": return { type: "accessibility.completed", payload };
    case "accessibility.failed":    return { type: "accessibility.failed",    payload };

    // Plan L auto-fix events
    case "auto_fix.attempted":        return { type: "auto_fix.attempted",        payload };
    case "auto_fix.budget_exhausted": return { type: "auto_fix.budget_exhausted", payload };
    case "auto_fix.failed":           return { type: "auto_fix.failed",           payload };

    // Plan S.5 visual-quality gate events
    case "visual_quality.started":    return { type: "visual_quality.started",    payload };
    case "visual_quality.passed":     return { type: "visual_quality.passed",     payload };
    case "visual_quality.failed":     return { type: "visual_quality.failed",     payload };
    case "visual_quality.skipped":    return { type: "visual_quality.skipped",    payload };
    case "visual_quality.completed":  return { type: "visual_quality.completed",  payload };
    case "visual_quality.errored":    return { type: "visual_quality.errored",    payload };

    // Plan S.2 researcher brief events. Carry the InspirationBrief payload
    // through to the SSE stream so ResearcherBriefCard can render the
    // chosen palette / typography / patterns on the rail timeline. The
    // conductor wraps payloads with { attempt, roleId }; the brief itself
    // sits under payload.brief.
    case "researcher.brief.started":   return { type: "researcher.brief.started",   payload };
    case "researcher.brief.completed": return { type: "researcher.brief.completed", payload };
    case "researcher.brief.skipped":   return { type: "researcher.brief.skipped",   payload };
    case "researcher.brief.failed":    return { type: "researcher.brief.failed",    payload };

    // Plan S.4 canvas + designer events. Without these mappings the engine's
    // emit() lands at the broker as default:null, the SSE stream never sees
    // them, and CanvasShellWired's hooks (useCanvasManifest /
    // useDesignerProposal) hang forever on the "Generating design options…"
    // skeleton because the proposal payload never arrives client-side.
    case "architect.canvas_manifest.emitted": return { type: "architect.canvas_manifest.emitted", payload };
    case "designer.proposal.emitted":          return { type: "designer.proposal.emitted",          payload };
    case "designer.proposal.failed":           return { type: "designer.proposal.failed",           payload };
    case "canvas.options.requested":           return { type: "canvas.options.requested",           payload };
    case "canvas.option.selected":             return { type: "canvas.option.selected",             payload };
    case "canvas.refinement.started":          return { type: "canvas.refinement.started",          payload };
    case "canvas.refinement.completed":        return { type: "canvas.refinement.completed",        payload };

    // Plan SPU — Designer three-pass + AssetGenerator events. Pass-through
    // mapping (same shape on both sides) so the SSE stream surfaces them to
    // any client hook subscribing to the broker. UI consumers land in a
    // separate slice; for now the events flow through unchanged.
    case "designer.draft.completed":     return { type: "designer.draft.completed",     payload };
    case "designer.critique.started":    return { type: "designer.critique.started",    payload };
    case "designer.critique.completed":  return { type: "designer.critique.completed",  payload };
    case "designer.revise.started":      return { type: "designer.revise.started",      payload };
    case "designer.revise.completed":    return { type: "designer.revise.completed",    payload };
    case "asset.gen.started":            return { type: "asset.gen.started",            payload };
    case "asset.gen.completed":          return { type: "asset.gen.completed",          payload };
    case "asset.gen.failed":             return { type: "asset.gen.failed",             payload };

    // SchemaArchitect three-pass (proposal → critique → revise) lifecycle +
    // schema direction selection. Without these mappings the engine's emit()
    // lands at the broker as default:null and SchemaCanvas never receives the
    // events it needs to render the schema direction picker.
    case "schema_architect.proposal.started":   return { type: "schema_architect.proposal.started",   payload };
    case "schema_architect.proposal.emitted":   return { type: "schema_architect.proposal.emitted",   payload };
    case "schema_architect.proposal.completed": return { type: "schema_architect.proposal.completed", payload };
    case "schema_architect.proposal.failed":    return { type: "schema_architect.proposal.failed",    payload };
    case "schema_architect.proposal.skipped":   return { type: "schema_architect.proposal.skipped",   payload };
    case "schema_architect.critique.started":   return { type: "schema_architect.critique.started",   payload };
    case "schema_architect.critique.completed": return { type: "schema_architect.critique.completed", payload };
    case "schema_architect.revise.started":     return { type: "schema_architect.revise.started",     payload };
    case "schema_architect.revise.completed":   return { type: "schema_architect.revise.completed",   payload };
    case "schema.direction.selected":           return { type: "schema.direction.selected",           payload };

    default:                        return null;
  }
}
