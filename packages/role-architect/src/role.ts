import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
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
        deepPlanModel: this.deepPlanModel
      });
    } catch (err) {
      events.push({ eventType: "architect.pass2.failed", payload: { error: (err as Error).message, scope: report.scope } });
      throw err;
    }
    events.push({ eventType: "architect.pass2.completed", payload: { scope: artifact.scope, artifact } });

    return { events, diff: { kind: "none" } };
  }
}
