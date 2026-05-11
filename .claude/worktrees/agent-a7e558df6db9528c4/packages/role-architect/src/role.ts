import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { isPriorRitualContext, type PriorRitualContext } from "@atlas/ritual-engine";
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
    events.push({ eventType: "architect.pass1.completed", payload: { passed: report.passed, scope: report.scope } });

    if (!report.passed) {
      for (const q of report.questions.filter((x) => x.severity === "blocker")) {
        events.push({ eventType: "architect.triage.needs_input", payload: { question: q.question, reason: q.reason } });
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
        priorRitual: inv.priorArtifact
      });
    } catch (err) {
      events.push({ eventType: "architect.pass2.failed", payload: { error: (err as Error).message, scope: report.scope } });
      throw err;
    }
    events.push({ eventType: "architect.pass2.completed", payload: { scope: artifact.scope, artifact } });

    return { events, diff: { kind: "none" } };
  }
}

/** True when at least one of the parent's gate reports has passed=false.
 *  Defensive about shape: the reports are typed as `unknown` on the
 *  PriorRitualContext to avoid coupling role-architect to the Zod
 *  schemas of role-security and role-accessibility. */
function hasFailingGateReport(prior: PriorRitualContext): boolean {
  return failingReport(prior.parentSecurityReport) !== null
      || failingReport(prior.parentAccessibilityReport) !== null;
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

  const allIssues = [
    ...(security?.issues ?? []).map((i) => ({ ...i, gate: "security" as const })),
    ...(accessibility?.issues ?? []).map((i) => ({ ...i, gate: "accessibility" as const }))
  ];

  const enumerated = allIssues
    .map((i, idx) => {
      const loc = i.file ? `${i.file}${i.line ? `:${i.line}` : ""}` : "(unspecified file)";
      return `  ${idx + 1}. [${i.gate}/${i.severity}] ${i.code} @ ${loc} — ${i.message}`;
    })
    .join("\n");

  const summary = `${allIssues.length} gate finding${allIssues.length === 1 ? "" : "s"} from the prior ritual must be remediated. Apply minimum-diff fixes that resolve every critical/high issue and as many medium/low as the change permits without regression.`;

  return {
    scope: "bug-fix",
    bugReport: {
      phase1_reproduce: `The parent ritual produced a working diff but failed gates. Issues observed:\n${enumerated}`,
      phase2_isolate: `Each issue references a specific file/line in the parent ritual's diff. The fixes can be applied directly to those locations without further investigation.`,
      phase3_hypothesize: `The developer pass produced syntactically valid code but missed accessibility/security best practices that the gate skills enforce. Patches should target the specific code patterns flagged (contrast classes, missing aria attributes, focus styles, semantic markup, etc.).`,
      phase4_verify: `Re-run the failed gates after applying fixes. Pass criterion: no critical-severity issues remain. High/medium/low remediation is opportunistic.`,
      rootCause: summary
    },
    graphSlice: {
      bytes: graphSlice.bytes,
      hash: graphSlice.hash
    }
  };
}
