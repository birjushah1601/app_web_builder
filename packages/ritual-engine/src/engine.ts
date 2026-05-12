import { randomUUID } from "crypto";
import type { Conductor } from "@atlas/conductor";
import type { ArtifactKind } from "@atlas/canvas-runtime";
import type { EventSink, EditClass, RitualEvent } from "./events.js";
import type { PersonaPreferences } from "./personas.js";
import { applyTransition, isTerminal, type RitualState, type RitualTransition } from "./state.js";
import { applyApproval, type ApprovalDecision } from "./approval.js";
import { enforcePersonaGate, type RiskAccepted } from "./risk-accept.js";
import type { RitualHydrator } from "./hydrator.js";
import { buildPriorRitualContext, type PriorRitualContext } from "./prior-ritual-context.js";
import { CanvasPauseRegistry, DEFAULT_CANVAS_PAUSE_TIMEOUT_MS } from "./canvas-pause.js";

export interface RitualEngineOptions {
  conductor: Conductor;
  eventSink: EventSink;
  personaPreferences: PersonaPreferences;
  sandboxApplier?: SandboxApplier;
  /** Plan H: optional fallback for getRitual on in-memory miss.
   *  When omitted, getRitual returns undefined for unknown IDs (today's behavior). */
  hydrator?: RitualHydrator;
  /** Plan I: ordered list of role IDs to dispatch after a successful
   *  developer pass (when developerOutput.diff is non-empty). Each role
   *  is dispatched via Conductor.dispatch({ forceRoleId, priorArtifact }).
   *  A gate-failing role (report.passed === false) escalates the ritual
   *  and stops the chain. Default [] preserves today's architect→developer-only flow. */
  postDeveloperChain?: string[];
  /** Plan L: when true AND a chained gate fails, the engine auto-triggers
   *  a refine() with the gate's report folded into PriorRitualContext as
   *  a fix request. Capped at MAX_FIX_ATTEMPTS per ritual lineage.
   *  Default false preserves Plan I's escalate-and-stop behavior. */
  autoFixLoopEnabled?: boolean;
  /** Plan S.4: when true AND the architect's artifact carries a canvasManifest
   *  with a design-blocking mode, the engine dispatches Researcher → Designer →
   *  emits canvas.options.requested → awaits canvasPauseRegistry.waitForOption →
   *  resumes Developer with selectedTokens folded into priorArtifact.
   *  Researcher / Designer dispatch is skipped if their roles aren't registered
   *  (sub-flag composition). Default false preserves today's behavior. */
  canvasFlowEnabled?: boolean;
  canvasPauseRegistry?: CanvasPauseRegistry;
  canvasPauseTimeoutMs?: number;
  /** "fast" mode (RitualOptions per spec) skips Researcher; default "considered". */
  ritualMode?: "fast" | "considered";
}

/** Plan L: hard cap on auto-fix attempts per ritual lineage to prevent
 *  infinite retry loops on uncfixable issues. Each attempt re-runs the
 *  full architect → developer → gates pipeline against the fresh diff. */
const MAX_FIX_ATTEMPTS = 2;

export interface StartInput {
  userTurn: string;
  editClass: EditClass;
  projectId: string;
  userId: string;
  /** Optional snapshot of files that already exist in the project's live
   *  sandbox. Threaded into the architect's RoleInvocation.currentFiles so
   *  the prompt assembler can prepend a "## Current sandbox files" section.
   *  Absent → architect runs without anchor-file context (today's default). */
  currentFiles?: ReadonlyArray<{ path: string; content?: string }>;
  /** Plan PFP — optional user-provided hint that bypasses the architect's
   *  artifactKind classification. Threads into the architect's
   *  RoleInvocation.priorArtifact so role-architect can short-circuit. */
  artifactKindHint?: ArtifactKind;
  /** Plan SPU — user-supplied reference imagery. Folded into the
   *  architect's priorArtifact so it flows through to Designer for
   *  visual conditioning. Empty array → omitted from priorArtifact. */
  referenceImages?: ReadonlyArray<{ url: string; caption?: string }>;
}

/** Plan K: refine starts a NEW ritual linked to the parent via
 *  parentRitualId. The parent's snapshot is hydrated and packaged as
 *  PriorRitualContext, then threaded into the architect's priorArtifact. */
export interface RefineInput {
  parentRitualId: string;
  projectId: string;
  userId: string;
  userTurn: string;
  /** Same shape + intent as StartInput.currentFiles — refines also benefit
   *  from anchor-file context so the architect's plan stays aligned with the
   *  current tree (not just the parent ritual's view of it). */
  currentFiles?: ReadonlyArray<{ path: string; content?: string }>;
}

/** Events emitted by the role during dispatch. Plain JSON-serializable; safe
 *  to return across the RSC boundary so client code can render them. */
export interface RoleEventRecord {
  eventType: string;
  payload: unknown;
}

/** What the developer role produced when the architect handoff chained into
 *  it. The diff is a unified-diff patch the developer wants applied to the
 *  project's source tree; summary is the developer's plain-language description.
 *  Plan C (not yet built) will apply the diff to the running E2B sandbox. */
export interface DeveloperOutputRecord {
  diff: string;
  summary?: string;
}

/** Aggregate result of writing a developer's diff into the project's
 *  sandbox. Mirrors apps/atlas-web/lib/sandbox/apply-diff-types.ts so
 *  that snapshot consumers (Server Action, ChatPanel) get the same
 *  shape on both sides without round-tripping through `unknown`. */
export interface SandboxApplyResult {
  ok: boolean;
  parsed: number;
  written: number;
  failed: number;
  skipped: number;
  files: Array<{
    path: string;
    status: "written" | "skipped" | "failed";
    reason?: string;
    bytesWritten?: number;
  }>;
  parseError?: string;
}

/** Optional injection on RitualEngineOptions. Implementations live
 *  outside the engine package (atlas-web wires the real adapter via
 *  E2B; engine tests can stub or omit). When omitted, start() skips
 *  the apply step entirely — backward-compatible with existing tests. */
export interface SandboxApplier {
  apply(projectId: string, diff: string): Promise<SandboxApplyResult>;
}

interface RitualRecord {
  state: RitualState;
  projectId: string;
  userId: string;
  artifact?: unknown;
  /** Full list of role events from the most recent dispatch on this ritual.
   *  Populated by start(); preserved for the lifetime of the in-memory record.
   *  Used by callers (UI) that need to surface what the role produced beyond
   *  just the final artifact (e.g. blocking questions from triage). */
  roleEvents?: RoleEventRecord[];
  /** Set when the developer role chained successfully after architect. */
  developerOutput?: DeveloperOutputRecord;
  sandboxApplyResult?: SandboxApplyResult;
  /** Plan I: present when SecurityRole ran in the post-developer chain. */
  securityReport?: unknown;
  /** Plan I: present when AccessibilityRole ran in the post-developer chain. */
  accessibilityReport?: unknown;
  /** Plan K: when this ritual was created via refine(), points back to
   *  the parent ritual whose snapshot was threaded into the architect's
   *  prompt as PriorRitualContext. */
  parentRitualId?: string;
  /** Plan L: incremented each time the engine auto-triggers a refine() in
   *  response to a chained gate failure. Inherited from parent for child
   *  rituals so MAX_FIX_ATTEMPTS gates the whole lineage. */
  fixAttempts?: number;
  /** Plan S.4: design tokens picked by the user (or auto-selected on timeout)
   *  during the canvas pause. Folded into the developer's priorArtifact so
   *  generated code respects the chosen direction. */
  selectedTokens?: unknown;
  /** Plan S.4: snapshot of the architect's canvasManifest when canvas flow
   *  is on. Persisted so the gate-visual-quality role + diagnostic UIs can
   *  recover the persona-tier audience + mode list post-hoc. */
  canvasManifest?: unknown;
}

/** Read-only view of a ritual's persisted state. Returned by getRitual(). */
export interface RitualSnapshot {
  state: RitualState;
  projectId: string;
  userId: string;
  artifact?: unknown;
  roleEvents: RoleEventRecord[];
  developerOutput?: DeveloperOutputRecord;
  sandboxApplyResult?: SandboxApplyResult;
  /** Plan I: present when SecurityRole ran. The role's full report.
   *  passed=false means a critical issue → ritual.escalated. */
  securityReport?: unknown;
  /** Plan I: present when AccessibilityRole ran. Same shape contract. */
  accessibilityReport?: unknown;
  /** Plan K: present when ritual was created via refine(); links lineage. */
  parentRitualId?: string;
  /** Plan L: count of auto-fix attempts in this ritual's lineage. ChatPanel
   *  uses this to render an "(auto-fix #N)" badge. */
  fixAttempts?: number;
  /** Plan S.4: design tokens picked by the user (or auto-selected on timeout)
   *  during the canvas pause. Folded into the developer's priorArtifact so
   *  generated code respects the chosen direction. */
  selectedTokens?: unknown;
  /** Plan S.4: snapshot of the architect's canvasManifest when canvas flow
   *  is on. Persisted so the gate-visual-quality role + diagnostic UIs can
   *  recover the persona-tier audience + mode list post-hoc. */
  canvasManifest?: unknown;
}

export class RitualEngine {
  private readonly conductor: Conductor;
  private readonly sink: EventSink;
  private readonly prefs: PersonaPreferences;
  private readonly applier?: SandboxApplier;
  private readonly hydrator?: RitualHydrator;
  private readonly postDeveloperChain: readonly string[];
  private readonly autoFixLoopEnabled: boolean;
  private readonly canvasFlowEnabled: boolean;
  private readonly canvasPauseRegistry?: CanvasPauseRegistry;
  private readonly canvasPauseTimeoutMs: number;
  private readonly ritualMode: "fast" | "considered";
  private readonly rituals = new Map<string, RitualRecord>();

  constructor(opts: RitualEngineOptions) {
    this.conductor = opts.conductor;
    this.sink = opts.eventSink;
    this.prefs = opts.personaPreferences;
    this.applier = opts.sandboxApplier;
    this.postDeveloperChain = opts.postDeveloperChain ?? [];
    this.autoFixLoopEnabled = opts.autoFixLoopEnabled ?? false;
    this.hydrator = opts.hydrator;
    this.canvasFlowEnabled = opts.canvasFlowEnabled ?? false;
    if (opts.canvasPauseRegistry !== undefined) {
      this.canvasPauseRegistry = opts.canvasPauseRegistry;
    }
    this.canvasPauseTimeoutMs = opts.canvasPauseTimeoutMs ?? DEFAULT_CANVAS_PAUSE_TIMEOUT_MS;
    this.ritualMode = opts.ritualMode ?? "considered";
  }

  async start(input: StartInput): Promise<string> {
    return this._runRitual({ ...input });
  }

  /** Plan K: start a NEW ritual linked to a parent. The parent's snapshot
   *  is hydrated and packaged as PriorRitualContext, then threaded into
   *  the architect's priorArtifact for context-aware planning. */
  async refine(input: RefineInput): Promise<string> {
    const parent = await this.getRitual(input.parentRitualId);
    if (!parent) {
      throw new Error(`refine: parent ritual ${input.parentRitualId} not found`);
    }
    if (parent.projectId !== input.projectId) {
      throw new Error(
        `refine: project mismatch — parent.projectId=${parent.projectId} input.projectId=${input.projectId}`
      );
    }

    const priorContext = buildPriorRitualContext({
      ritualId: input.parentRitualId,
      artifact: parent.artifact,
      developerOutput: parent.developerOutput,
      roleEvents: parent.roleEvents
    });

    // Refinement of a structural ritual stays structural; cosmetic stays cosmetic.
    const editClass: EditClass = parent.developerOutput?.diff
      ? "structural"
      : "cosmetic";

    return this._runRitual({
      userTurn: input.userTurn,
      editClass,
      projectId: input.projectId,
      userId: input.userId,
      priorContext,
      parentRitualId: input.parentRitualId,
      ...(input.currentFiles !== undefined ? { currentFiles: input.currentFiles } : {})
    });
  }

  private async _runRitual(input: StartInput & {
    priorContext?: PriorRitualContext;
    parentRitualId?: string;
    /** Plan L: when triggered by the auto-fix loop, the engine sets this to
     *  parent.fixAttempts + 1 so the new ritual inherits the budget. */
    fixAttempts?: number;
  }): Promise<string> {
    const ritualId = `r-${randomUUID()}`;
    const initialRecord: RitualRecord = {
      state: "visualize",
      projectId: input.projectId,
      userId: input.userId
    };
    if (input.parentRitualId) {
      initialRecord.parentRitualId = input.parentRitualId;
    }
    if (input.fixAttempts !== undefined) {
      initialRecord.fixAttempts = input.fixAttempts;
    }
    this.rituals.set(ritualId, initialRecord);

    await this.emit({
      type: "ritual.started",
      ritualId,
      ts: new Date().toISOString(),
      payload: {
        intent: input.userTurn,
        editClass: input.editClass,
        projectId: input.projectId,
        userId: input.userId,
        // Plan K: parentRitualId in the started event lets hydrator + thread API recover lineage.
        ...(input.parentRitualId ? { parentRitualId: input.parentRitualId } : {})
      }
    });

    // Dispatch Architect role for the Visualize step. When refining, pass
    // the PriorRitualContext as priorArtifact so the architect's prompt
    // assembly can prepend a "Previous turn" preamble. When currentFiles
    // is set (atlas-web wires this from a live sandbox snapshot), thread
    // it through too so the architect prompt also gets a "## Current
    // sandbox files" section. Plan PFP: when artifactKindHint is set,
    // fold it into priorArtifact so role-architect can short-circuit the
    // artifactKind classification pass.
    const dispatchOptions: { priorArtifact?: unknown; currentFiles?: ReadonlyArray<{ path: string; content?: string }> } = {};
    const architectPriorArtifact = {
      ...(input.priorContext ? input.priorContext : {}),
      ...(input.artifactKindHint ? { artifactKindHint: input.artifactKindHint } : {}),
      // Plan SPU — only thread referenceImages when non-empty so downstream
      // `=== undefined` checks behave consistently with exactOptionalPropertyTypes.
      ...(input.referenceImages && input.referenceImages.length > 0
        ? { referenceImages: input.referenceImages }
        : {})
    };
    if (Object.keys(architectPriorArtifact).length > 0) {
      dispatchOptions.priorArtifact = architectPriorArtifact;
    }
    if (input.currentFiles !== undefined) dispatchOptions.currentFiles = input.currentFiles;

    const result = await this.conductor.dispatch(
      {
        ritualId: ritualId as unknown as Parameters<typeof this.conductor.dispatch>[0]["ritualId"],
        graphVersion: 0,
        userTurn: input.userTurn,
        projectId: input.projectId
      },
      Object.keys(dispatchOptions).length > 0 ? dispatchOptions : undefined
    );

    // Pull the artifact from the role's pass2.completed event (D.2 contract)
    const completed = result.output.events.find((e) => e.eventType.endsWith(".pass2.completed"));
    const artifact = (completed?.payload as { artifact?: unknown } | undefined)?.artifact;
    const record = this.rituals.get(ritualId)!;
    record.artifact = artifact;
    // Capture every role event so callers can introspect what the role
    // produced (e.g. ambiguity questions when triage blocked, intermediate
    // started/failed events for diagnostic UIs).
    record.roleEvents = result.output.events.map((e) => ({
      eventType: e.eventType,
      payload: e.payload as unknown
    }));

    // Plan S.4: canvas flow — when enabled AND the architect's artifact carries
    // a canvasManifest with a design-blocking mode, dispatch Researcher →
    // Designer → emit canvas.options.requested → await pause → emit
    // canvas.option.selected → fold selectedTokens into developer's priorArtifact.
    let selectedTokens: unknown | undefined;
    if (this.canvasFlowEnabled && artifact && input.editClass !== "cosmetic") {
      const manifest = (artifact as { canvasManifest?: unknown }).canvasManifest;
      const designIntent = (artifact as { designIntent?: unknown }).designIntent;
      const manifestRecord =
        manifest && typeof manifest === "object" ? (manifest as { modes?: unknown[]; artifactKind?: unknown }) : undefined;
      const modes = Array.isArray(manifestRecord?.modes) ? manifestRecord.modes : [];
      const hasBlockingDesign = modes.some(
        (m) => typeof m === "object" && m !== null && (m as { blockingFor?: unknown }).blockingFor === "design"
      );

      if (manifestRecord) {
        record.canvasManifest = manifest;
        await this.emit({
          type: "architect.canvas_manifest.emitted",
          ritualId,
          ts: new Date().toISOString(),
          payload: { manifest }
        });
      }

      if (hasBlockingDesign) {
        // Researcher (skipped in fast mode OR if dispatch fails — captured into roleEvents).
        let brief: unknown | undefined;
        if (this.ritualMode !== "fast") {
          try {
            const r = await this.conductor.dispatch(
              {
                ritualId: ritualId as unknown as Parameters<typeof this.conductor.dispatch>[0]["ritualId"],
                graphVersion: 0,
                userTurn: input.userTurn,
                projectId: input.projectId
              },
              { forceRoleId: "researcher", priorArtifact: { designIntent } }
            );
            record.roleEvents = [
              ...(record.roleEvents ?? []),
              ...r.output.events.map((e) => ({ eventType: e.eventType, payload: e.payload as unknown }))
            ];
            const completedBrief = r.output.events.find((e) => e.eventType === "researcher.brief.completed");
            brief = (completedBrief?.payload as { brief?: unknown } | undefined)?.brief;
          } catch (err) {
            record.roleEvents = [
              ...(record.roleEvents ?? []),
              {
                eventType: "researcher.dispatch.failed",
                payload: { error: err instanceof Error ? err.message : String(err) }
              }
            ];
          }
        }

        // Designer (always when canvas flow on; runs with empty brief if researcher skipped/failed).
        let proposal: { recommended: { id: string; tokens: unknown }; alternates: unknown } | undefined;
        try {
          const d = await this.conductor.dispatch(
            {
              ritualId: ritualId as unknown as Parameters<typeof this.conductor.dispatch>[0]["ritualId"],
              graphVersion: 0,
              userTurn: input.userTurn,
              projectId: input.projectId
            },
            { forceRoleId: "designer", priorArtifact: { artifact, brief, designIntent } }
          );
          record.roleEvents = [
            ...(record.roleEvents ?? []),
            ...d.output.events.map((e) => ({ eventType: e.eventType, payload: e.payload as unknown }))
          ];
          const ev = d.output.events.find((e) => e.eventType === "designer.proposal.emitted");
          proposal = (ev?.payload as { proposal?: typeof proposal } | undefined)?.proposal;
        } catch (err) {
          record.roleEvents = [
            ...(record.roleEvents ?? []),
            {
              eventType: "designer.dispatch.failed",
              payload: { error: err instanceof Error ? err.message : String(err) }
            }
          ];
        }

        // Pause + emit canvas.options.requested + await selection.
        if (proposal && this.canvasPauseRegistry) {
          await this.emit({
            type: "canvas.options.requested",
            ritualId,
            ts: new Date().toISOString(),
            payload: { proposal, manifest }
          });
          const resolution = await this.canvasPauseRegistry.waitForOption({
            ritualId,
            timeoutMs: this.canvasPauseTimeoutMs,
            recommendedFallback: { directionId: proposal.recommended.id, tokens: proposal.recommended.tokens }
          });
          selectedTokens = resolution.tokens;
          record.selectedTokens = selectedTokens;
          await this.emit({
            type: "canvas.option.selected",
            ritualId,
            ts: new Date().toISOString(),
            payload: {
              directionId: resolution.directionId,
              tokens: resolution.tokens,
              autoSelected: resolution.autoSelected
            }
          });
        }
      }
    }

    // Plan S.4: developer receives architect artifact merged with selectedTokens
    // (when canvas flow resolved). Falls back to the bare architect artifact
    // when canvas flow is off or no design pause occurred.
    const developerPriorArtifact =
      selectedTokens !== undefined && artifact && typeof artifact === "object"
        ? { ...(artifact as object), selectedTokens }
        : artifact;

    // Plan B: chain into the developer role when:
    //   - architect produced an artifact (triage passed + pass2 ran)
    //   - the conductor has a "developer" role registered
    //   - the edit class isn't cosmetic (cosmetic edits skip code-gen)
    // Failures inside the developer dispatch are caught and recorded into
    // roleEvents but do NOT throw — we still want to surface the architect
    // plan + the developer-failure reason to the user, not a 500.
    if (artifact && input.editClass !== "cosmetic") {
      try {
        const devResult = await this.conductor.dispatch(
          {
            ritualId: ritualId as unknown as Parameters<typeof this.conductor.dispatch>[0]["ritualId"],
            graphVersion: 0,
            userTurn: input.userTurn,
            projectId: input.projectId
          },
          { forceRoleId: "developer", priorArtifact: developerPriorArtifact }
        );
        record.developerOutput = (devResult.output.diff.kind === "patch")
          ? { diff: devResult.output.diff.body ?? "", summary: extractDeveloperSummary(devResult.output.events) }
          : undefined;
        record.roleEvents = [
          ...(record.roleEvents ?? []),
          ...devResult.output.events.map((e) => ({ eventType: e.eventType, payload: e.payload as unknown }))
        ];

        // Plan C: write the diff into the live preview sandbox if an
        // applier is configured. Failures inside apply are captured into
        // the snapshot — never re-thrown — so the architect plan and
        // developer diff still surface to the user.
        if (this.applier && devResult.output.diff.kind === "patch" && devResult.output.diff.body) {
          await this.emit({
            type: "sandbox.apply.started",
            ritualId,
            ts: new Date().toISOString(),
            payload: {}
          });
          try {
            const applyResult = await this.applier.apply(input.projectId, devResult.output.diff.body);
            record.sandboxApplyResult = applyResult;
            await this.emit({
              type: "sandbox.apply.completed",
              ritualId,
              ts: new Date().toISOString(),
              payload: {
                ok: applyResult.ok,
                parsed: applyResult.parsed,
                written: applyResult.written,
                failed: applyResult.failed
              }
            });
          } catch (err) {
            record.sandboxApplyResult = {
              ok: false, parsed: 0, written: 0, failed: 0, skipped: 0,
              files: [], parseError: `applier threw: ${err instanceof Error ? err.message : String(err)}`
            };
            await this.emit({
              type: "sandbox.apply.failed",
              ritualId,
              ts: new Date().toISOString(),
              payload: { error: err instanceof Error ? err.message : String(err) }
            });
          }
        }

        // Plan I: post-developer chain (Security → Accessibility per factory
        // config). Runs only when developer produced a real diff. A
        // gate-failing role (report.passed === false) escalates the ritual
        // and stops the chain. Empty chain = today's behavior.
        if (
          record.developerOutput?.diff &&
          this.postDeveloperChain.length > 0
        ) {
          for (const roleId of this.postDeveloperChain) {
            try {
              const chainResult = await this.conductor.dispatch(
                {
                  ritualId: ritualId as unknown as Parameters<typeof this.conductor.dispatch>[0]["ritualId"],
                  graphVersion: 0,
                  userTurn: record.developerOutput.diff,
                  projectId: input.projectId
                },
                { forceRoleId: roleId, priorArtifact: record.developerOutput }
              );

              record.roleEvents = [
                ...(record.roleEvents ?? []),
                ...chainResult.output.events.map((e) => ({
                  eventType: e.eventType,
                  payload: e.payload as unknown
                }))
              ];

              const completed = chainResult.output.events.find(
                (e) => e.eventType === `${roleId}.completed`
              );
              const payload = completed?.payload as
                | { passed?: boolean; report?: unknown }
                | undefined;

              if (roleId === "security") {
                record.securityReport = payload?.report;
              } else if (roleId === "accessibility") {
                record.accessibilityReport = payload?.report;
              }

              if (payload?.passed === false) {
                record.state = "escalated";
                // Use the existing ritual.escalation_requested event shape
                // — its payload is { reason, requestedBy }. Encode the
                // gate ID + report into reason (JSON-stringified) so
                // downstream consumers can recover the structured info.
                const gateLabel = roleId === "security" ? "L4-security" : "L5-compliance";
                await this.emit({
                  type: "ritual.escalation_requested",
                  ritualId,
                  ts: new Date().toISOString(),
                  payload: {
                    reason: `${gateLabel}-gate-failed: ${JSON.stringify(payload.report)}`,
                    requestedBy: roleId
                  }
                });

                // Plan L: auto-fix loop. When enabled AND budget remains,
                // synthesize a fix-request userTurn from the issues + trigger
                // _runRitual with the gate report folded into PriorRitualContext.
                const currentAttempts = record.fixAttempts ?? 0;
                if (this.autoFixLoopEnabled && currentAttempts < MAX_FIX_ATTEMPTS) {
                  const issues = (payload.report as { issues?: Array<{ severity?: string; message?: string }> })?.issues ?? [];
                  const issuesAsBullets = issues
                    .map((i) => `- [${i.severity ?? "unknown"}] ${i.message ?? "(no message)"}`)
                    .join("\n");
                  const fixUserTurn = `Address the ${gateLabel} findings:\n${issuesAsBullets}`;
                  const nextAttempt = currentAttempts + 1;

                  await this.emit({
                    type: "auto_fix.attempted",
                    ritualId,
                    ts: new Date().toISOString(),
                    payload: { gate: gateLabel, attemptNumber: nextAttempt, parentRitualId: ritualId }
                  });

                  try {
                    await this._runRitual({
                      userTurn: fixUserTurn,
                      editClass: "structural",
                      projectId: input.projectId,
                      userId: input.userId,
                      priorContext: buildPriorRitualContext({
                        ritualId,
                        artifact: record.artifact,
                        developerOutput: record.developerOutput,
                        roleEvents: record.roleEvents,
                        securityReport: record.securityReport,
                        accessibilityReport: record.accessibilityReport
                      }),
                      parentRitualId: ritualId,
                      fixAttempts: nextAttempt
                    });
                  } catch (err) {
                    // Auto-fix infrastructure failed (LLM/conductor error).
                    // Don't retry — emit a synthetic event and let the original
                    // escalation stand.
                    await this.emit({
                      type: "auto_fix.failed",
                      ritualId,
                      ts: new Date().toISOString(),
                      payload: { gate: gateLabel, error: err instanceof Error ? err.message : String(err) }
                    });
                  }
                } else if (this.autoFixLoopEnabled && currentAttempts >= MAX_FIX_ATTEMPTS) {
                  await this.emit({
                    type: "auto_fix.budget_exhausted",
                    ritualId,
                    ts: new Date().toISOString(),
                    payload: { gate: gateLabel, attempts: currentAttempts }
                  });
                }
                break;
              }
            } catch (err) {
              // Chain dispatch failure (unknown-role, provider error, etc.)
              // — record a synthetic event and stop the chain. Don't escalate
              // since the underlying gate didn't actually fail.
              record.roleEvents = [
                ...(record.roleEvents ?? []),
                {
                  eventType: `${roleId}.dispatch.failed`,
                  payload: { error: err instanceof Error ? err.message : String(err) }
                }
              ];
              break;
            }
          }
        }
      } catch (err) {
        // unknown-role (developer not registered) or BothProvidersFailedError
        // etc. Record a synthetic event so the UI can show what went wrong
        // without the whole ritual erroring.
        record.roleEvents = [
          ...(record.roleEvents ?? []),
          {
            eventType: "developer.dispatch.failed",
            payload: { error: err instanceof Error ? err.message : String(err) }
          }
        ];
      }
    }

    // Plan I: if the post-developer chain escalated (gate failure), skip
    // the artifact_emitted transition — the ritual is already terminal
    // (state === "escalated"), and applyTransition would throw
    // InvalidTransitionError on a non-escalate transition from a terminal
    // state.
    if (record.state === "escalated") {
      return ritualId;
    }

    await this.emit({
      type: "ritual.artifact_emitted",
      ritualId,
      ts: new Date().toISOString(),
      payload: { fromRole: result.roleId, artifact: artifact ?? null }
    });

    const tx: RitualTransition = input.editClass === "cosmetic"
      ? { kind: "artifact_emitted_cosmetic" }
      : { kind: "artifact_emitted" };
    await this.transition(ritualId, tx);
    return ritualId;
  }

  // Pulls the developer's summary (and ergo signals success) from its
  // emitted events. The .completed event always carries summary; if it's
  // missing, the role didn't reach a winner, and we return undefined.

  /** Read-only snapshot of a ritual's persisted state. Returns undefined if
   *  the ritualId is unknown to this engine instance (engine state is
   *  in-memory; rituals from a previous process are not reachable). */
  async getRitual(ritualId: string): Promise<RitualSnapshot | undefined> {
    const r = this.rituals.get(ritualId);
    if (r) {
      return {
        state: r.state,
        projectId: r.projectId,
        userId: r.userId,
        artifact: r.artifact,
        roleEvents: r.roleEvents ?? [],
        developerOutput: r.developerOutput,
        sandboxApplyResult: r.sandboxApplyResult,
        securityReport: r.securityReport,
        accessibilityReport: r.accessibilityReport,
        parentRitualId: r.parentRitualId,
        fixAttempts: r.fixAttempts,
        selectedTokens: r.selectedTokens,
        canvasManifest: r.canvasManifest
      };
    }
    // Plan H: in-memory miss — fall back to hydrator if configured.
    if (this.hydrator) {
      const hydrated = await this.hydrator.hydrate(ritualId);
      return hydrated ?? undefined;
    }
    return undefined;
  }

  async approve(ritualId: string, decision: ApprovalDecision): Promise<void> {
    const tx = applyApproval(decision);
    await this.transition(ritualId, tx);
    if (decision.kind === "approved") {
      await this.emit({
        type: "ritual.approved",
        ritualId,
        ts: new Date().toISOString(),
        payload: { approvedBy: decision.approvedBy, persona: decision.persona }
      });
    } else {
      await this.emit({
        type: "ritual.changes_requested",
        ritualId,
        ts: new Date().toISOString(),
        payload: { requestedBy: decision.requestedBy, notes: decision.notes }
      });
    }
  }

  async acceptRisk(ritualId: string, event: RiskAccepted): Promise<void> {
    enforcePersonaGate(event); // throws PersonaGateError if disallowed
    await this.emit({
      type: "ritual.risk_accepted",
      ritualId,
      ts: new Date().toISOString(),
      payload: event
    });
  }

  async escalate(ritualId: string, reason: string, requestedBy: string): Promise<void> {
    await this.emit({
      type: "ritual.escalation_requested",
      ritualId,
      ts: new Date().toISOString(),
      payload: { reason, requestedBy }
    });
    await this.transition(ritualId, { kind: "escalate", reason });
  }

  async markBuildComplete(ritualId: string): Promise<void> {
    await this.transition(ritualId, { kind: "merge_gates_green" });
  }

  state(ritualId: string): RitualState {
    const r = this.rituals.get(ritualId);
    if (!r) throw new Error(`unknown ritualId: ${ritualId}`);
    return r.state;
  }

  artifact(ritualId: string): unknown {
    return this.rituals.get(ritualId)?.artifact;
  }

  /** Evict an in-memory ritual record. Call after observing `ritual.completed`
   *  to prevent unbounded growth in long-running processes. Idempotent. */
  dispose(ritualId: string): void {
    this.rituals.delete(ritualId);
  }

  private async transition(ritualId: string, tx: RitualTransition): Promise<void> {
    const record = this.rituals.get(ritualId);
    if (!record) throw new Error(`unknown ritualId: ${ritualId}`);
    const from = record.state;
    const to = applyTransition(from, tx);
    record.state = to;
    await this.emit({
      type: "ritual.transitioned",
      ritualId,
      ts: new Date().toISOString(),
      payload: { from, to, transitionKind: tx.kind }
    });
    if (isTerminal(to)) {
      await this.emit({
        type: "ritual.completed",
        ritualId,
        ts: new Date().toISOString(),
        payload: { finalState: to as "done" | "escalated" | "aborted" }
      });
    }
  }

  private async emit(event: RitualEvent): Promise<void> {
    await this.sink.emit(event);
  }
}

/** Pulls the developer's plain-text summary from its emitted events.
 *  The .completed event carries the winner's summary; if neither completed
 *  nor walkover landed (both providers failed), returns undefined. */
function extractDeveloperSummary(events: ReadonlyArray<{ eventType: string; payload: unknown }>): string | undefined {
  for (const evt of events) {
    if (evt.eventType === "developer.completed") {
      const p = evt.payload as { summary?: unknown };
      if (typeof p.summary === "string") return p.summary;
    }
  }
  return undefined;
}
