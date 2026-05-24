import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { isPriorRitualContext, type PriorRitualContext } from "@atlas/ritual-engine";
import { ArtifactKindSchema, type ArtifactKind } from "@atlas/canvas-runtime";
import { deepPlan, ARCHITECT_DEEP_PLAN_MODEL } from "./deep-plan.js";
import { triage, ARCHITECT_TRIAGE_MODEL } from "./triage.js";
import type { AmbiguityReport, ArchitectOutput } from "./types.js";

export interface ArchitectRoleOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  triageModel?: string;
  deepPlanModel?: string;
}

export class ArchitectRole implements Role {
  readonly id = "architect";
  private readonly llm: LLMProvider;
  private readonly skills: SkillRegistry;
  private readonly triageModel: string;
  private readonly deepPlanModel: string;

  constructor(opts: ArchitectRoleOptions) {
    this.llm = opts.llm;
    this.skills = opts.skills;
    this.triageModel = opts.triageModel ?? ARCHITECT_TRIAGE_MODEL;
    this.deepPlanModel = opts.deepPlanModel ?? ARCHITECT_DEEP_PLAN_MODEL;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];

    // Plan L follow-up: when the engine's auto-fix loop chains us as the
    // architect of a child ritual after a gate failure, the triage LLM
    // call routinely returns "needs more input" (compliance level, RTL
    // scope, etc.) — but a child ritual has no UI for the user to
    // answer. Detect fix-mode (PriorRitualContext + at least one failing
    // gate report) and synthesize a bug-fix artifact directly from the
    // gate findings, skipping the LLM triage + deepPlan calls entirely.
    // Saves tokens and unblocks the auto-fix loop.
    if (isPriorRitualContext(inv.priorArtifact) && hasFailingGateReport(inv.priorArtifact)) {
      const synthetic = buildFixModeArtifact(inv.priorArtifact, inv.graphSlice);
      events.push({
        eventType: "architect.pass1.started",
        payload: { ritualId: inv.ritualId, fixMode: true }
      });
      events.push({
        eventType: "architect.pass1.completed",
        payload: { passed: true, scope: "bug-fix", fixMode: true }
      });
      events.push({
        eventType: "architect.pass2.started",
        payload: { scope: "bug-fix", fixMode: true }
      });
      events.push({
        eventType: "architect.pass2.completed",
        payload: { scope: "bug-fix", artifact: synthetic, fixMode: true }
      });
      return { events, diff: { kind: "none" } };
    }

    // Plan PFP: when the user picked an artifactKind on the prompt-first
    // form, the engine threads it into inv.priorArtifact.artifactKindHint.
    // Extract it here so deepPlan can short-circuit the implicit
    // classification (which would otherwise be derived from specGraph.kind
    // inside synthesizeCanvasManifest). Sits next to the isPriorRitualContext
    // handling above — both are priorArtifact-derived advisory inputs.
    // The hint is advisory: pass1 still runs (scope/editClass classification
    // stays); only the artifactKind sub-step inside pass2 is skipped.
    const artifactKindHint = readArtifactKindHint(inv.priorArtifact);

    events.push({ eventType: "architect.pass1.started", payload: { ritualId: inv.ritualId } });
    let report: AmbiguityReport;
    try {
      report = await triage({
        userTurn: inv.userTurn,
        graphSlice: inv.graphSlice,
        llm: this.llm,
        triageModel: this.triageModel
      });
    } catch (err) {
      events.push({ eventType: "architect.pass1.failed", payload: { error: (err as Error).message } });
      throw err;
    }
    events.push({
      eventType: "architect.pass1.completed",
      payload: { passed: report.passed, scope: report.scope, hintApplied: artifactKindHint !== undefined }
    });

    if (!report.passed) {
      for (const q of report.questions.filter((x) => x.severity === "blocker")) {
        events.push({
          eventType: "architect.triage.needs_input",
          payload: {
            question: q.question,
            reason: q.reason,
            // Plan U (full): forward optional widget hints so the form
            // can render the right control instead of falling back to
            // the heuristic inference from the original Plan U slice.
            ...(q.widgetKind !== undefined ? { widgetKind: q.widgetKind } : {}),
            ...(q.options !== undefined ? { options: q.options } : {})
          }
        });
      }
      return { events, diff: { kind: "none" } };
    }

    events.push({ eventType: "architect.pass2.started", payload: { scope: report.scope } });
    let artifact: ArchitectOutput;
    try {
      artifact = await deepPlan({
        userTurn: inv.userTurn,
        graphSlice: inv.graphSlice,
        ambiguity: report,
        skills: this.skills,
        llm: this.llm,
        deepPlanModel: this.deepPlanModel,
        // Plan K: when refining, the engine threads PriorRitualContext via priorArtifact.
        // deepPlan checks the shape with isPriorRitualContext and ignores any other shape.
        priorRitual: inv.priorArtifact,
        // Plan PFP: hint forwarded so enrichArchitectOutput uses it as the
        // canvasManifest.artifactKind (overrides specGraph.kind). Only set
        // when defined to stay friendly with exactOptionalPropertyTypes.
        ...(artifactKindHint !== undefined ? { artifactKindHint } : {}),
        // exactOptionalPropertyTypes: only set when defined so deepPlan's
        // `if (input.currentFiles !== undefined)` check stays consistent.
        ...(inv.currentFiles !== undefined ? { currentFiles: [...inv.currentFiles] } : {})
      });
    } catch (err) {
      events.push({ eventType: "architect.pass2.failed", payload: { error: (err as Error).message, scope: report.scope } });
      throw err;
    }
    events.push({ eventType: "architect.pass2.completed", payload: { scope: artifact.scope, artifact } });

    // Plan S.4: when the artifact carries a canvasManifest (synthesized in
    // enrichArchitectOutput for design-affecting scopes), emit a dedicated
    // event so the engine + atlas-web broker can route the manifest into
    // the snapshot without re-parsing the full artifact.
    const manifest = (artifact as { canvasManifest?: unknown }).canvasManifest;
    if (manifest) {
      events.push({
        eventType: "architect.canvas_manifest.emitted",
        payload: { manifest }
      });
    }

    return { events, diff: { kind: "none" } };
  }
}

/** Plan PFP: extract the architect's artifactKindHint from inv.priorArtifact.
 *  Returns undefined when priorArtifact is absent / wrong shape / carries an
 *  unknown ArtifactKind value. Defensive about the shape so a malformed hint
 *  silently falls back to the existing classifier instead of crashing the
 *  whole ritual. The hint flows from the prompt-first form
 *  (atlas-web /projects/new) → submitPromptedProject → startRitual →
 *  engine.start(StartInput.artifactKindHint) → priorArtifact.artifactKindHint. */
function readArtifactKindHint(priorArtifact: unknown): ArtifactKind | undefined {
  if (!priorArtifact || typeof priorArtifact !== "object") return undefined;
  const hint = (priorArtifact as { artifactKindHint?: unknown }).artifactKindHint;
  if (hint === undefined) return undefined;
  const parsed = ArtifactKindSchema.safeParse(hint);
  return parsed.success ? parsed.data : undefined;
}

/** True when at least one of the parent's gate reports has passed=false.
 *  Defensive about shape: the reports are typed as `unknown` on the
 *  PriorRitualContext to avoid coupling role-architect to the Zod
 *  schemas of role-security, role-accessibility, and gate-build. */
function hasFailingGateReport(prior: PriorRitualContext): boolean {
  return failingReport(prior.parentSecurityReport) !== null
      || failingReport(prior.parentAccessibilityReport) !== null
      || failingBuildReport(prior.parentBuildReport) !== null;
}

interface MinimalGateReport {
  passed: boolean;
  issues: Array<{ severity: string; code: string; message: string; file?: string; line?: number }>;
}

function failingReport(report: unknown): MinimalGateReport | null {
  if (!report || typeof report !== "object") return null;
  const r = report as Record<string, unknown>;
  if (r.passed !== false) return null;
  const issues = Array.isArray(r.issues) ? (r.issues as MinimalGateReport["issues"]) : [];
  return { passed: false, issues };
}

interface MinimalBuildReport {
  passed: boolean;
  errorKind: string;
  template: string;
  command: string;
  errors: Array<{ file: string; line: number; col: number; severity: string; message: string; snippet?: string }>;
}

/** Build-gate reports use `errors[]` (file:line:col:message), not `issues[]`.
 *  Mirrors failingReport but for the BuildReport shape from @atlas/gate-build. */
function failingBuildReport(report: unknown): MinimalBuildReport | null {
  if (!report || typeof report !== "object") return null;
  const r = report as Record<string, unknown>;
  if (r.passed !== false) return null;
  if (!Array.isArray(r.errors)) return null;
  return {
    passed: false,
    errorKind: typeof r.errorKind === "string" ? r.errorKind : "compile",
    template: typeof r.template === "string" ? r.template : "(unknown)",
    command: typeof r.command === "string" ? r.command : "(unknown)",
    errors: r.errors as MinimalBuildReport["errors"]
  };
}

/** Build a deterministic bug-fix artifact from a parent's failing gate
 *  report. The shape matches BugFixOutputSchema in types.ts. The bug
 *  report's free-text fields are filled in with a structured enumeration
 *  of the issues so the developer pass has clear remediation targets. */
function buildFixModeArtifact(
  prior: PriorRitualContext,
  graphSlice: { bytes: string; hash: string }
): ArchitectOutput {
  const security = failingReport(prior.parentSecurityReport);
  const accessibility = failingReport(prior.parentAccessibilityReport);
  const build = failingBuildReport(prior.parentBuildReport);

  // Build errors first: they're compiler-authoritative. If the code doesn't
  // compile, the security/a11y findings don't matter — fix the compiler errors
  // before anything else.
  const buildEntries = (build?.errors ?? []).map((e) => ({
    gate: "build" as const,
    severity: e.severity,
    code: build?.errorKind ?? "compile",
    message: e.message,
    file: e.file,
    line: e.line
  }));
  const gateIssues = [
    ...(security?.issues ?? []).map((i) => ({ ...i, gate: "security" as const })),
    ...(accessibility?.issues ?? []).map((i) => ({ ...i, gate: "accessibility" as const }))
  ];
  const allIssues = [...buildEntries, ...gateIssues];

  const enumerated = allIssues
    .map((i, idx) => {
      const loc = i.file ? `${i.file}${i.line ? `:${i.line}` : ""}` : "(unspecified file)";
      return `  ${idx + 1}. [${i.gate}/${i.severity}] ${i.code} @ ${loc} — ${i.message}`;
    })
    .join("\n");

  // Phrase the report's free-text in the language of the dominant failure so
  // the developer prompt downstream reads coherently. Build failures get a
  // compiler-centric framing; gate-only failures keep the original wording.
  const hasBuildFailure = build !== null;
  const summary = hasBuildFailure
    ? `The parent ritual's diff failed the L0 build gate (${build!.errorKind}, ${build!.errors.length} error${build!.errors.length === 1 ? "" : "s"} from \`${build!.command}\`). Compile errors are authoritative — fix exactly the locations listed before addressing any gate findings.`
    : `${allIssues.length} gate finding${allIssues.length === 1 ? "" : "s"} from the prior ritual must be remediated. Apply minimum-diff fixes that resolve every critical/high issue and as many medium/low as the change permits without regression.`;

  const phase1 = hasBuildFailure
    ? `The parent ritual's diff failed to compile. Failures observed (compiler is authoritative — fix exactly these):\n${enumerated}`
    : `The parent ritual produced a working diff but failed gates. Issues observed:\n${enumerated}`;
  const phase2 = hasBuildFailure
    ? `Each compiler error references a specific file:line:col in the parent ritual's diff. Apply the fix at those exact locations; do not refactor unrelated code.`
    : `Each issue references a specific file/line in the parent ritual's diff. The fixes can be applied directly to those locations without further investigation.`;
  const phase3 = hasBuildFailure
    ? `The developer pass emitted code that the type-checker/syntactic checker rejected. Map each error message to its root cause (mismatched JSX, unescaped string literal, missing import, type incompatibility, etc.) and patch precisely. Gate findings (if any) are secondary — fix the compile first.`
    : `The developer pass produced syntactically valid code but missed accessibility/security best practices that the gate skills enforce. Patches should target the specific code patterns flagged (contrast classes, missing aria attributes, focus styles, semantic markup, etc.).`;
  const phase4 = hasBuildFailure
    ? `Re-run the L0 build gate. Pass criterion: exit code 0 from \`${build!.command}\`. After build passes, gates re-run; address any remaining findings opportunistically.`
    : `Re-run the failed gates after applying fixes. Pass criterion: no critical-severity issues remain. High/medium/low remediation is opportunistic.`;

  return {
    scope: "bug-fix",
    bugReport: {
      phase1_reproduce: phase1,
      phase2_isolate: phase2,
      phase3_hypothesize: phase3,
      phase4_verify: phase4,
      rootCause: summary
    },
    graphSlice: {
      bytes: graphSlice.bytes,
      hash: graphSlice.hash
    }
  };
}
