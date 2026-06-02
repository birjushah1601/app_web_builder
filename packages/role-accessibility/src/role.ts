import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { runAccessibilityCheck } from "./accessibility-check.js";

export interface AccessibilityRoleOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  model?: string;
}

export class AccessibilityRole implements Role {
  readonly id = "accessibility";
  private readonly opts: AccessibilityRoleOptions;
  constructor(opts: AccessibilityRoleOptions) { this.opts = opts; }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    events.push({ eventType: "accessibility.started", payload: { ritualId: inv.ritualId } });

    try {
      const checkResult = await runAccessibilityCheck({
        llm: this.opts.llm,
        skills: this.opts.skills,
        diff: inv.userTurn,
        graphSlice: inv.graphSlice,
        model: this.opts.model
      });
      const report = checkResult.report;
      // Plan G.4 Task 3 — record per-role usage tagged with roleId="accessibility".
      inv.usageTracker?.record(this.opts.llm.name, checkResult.model,
        { inputTokens: checkResult.usage.inputTokens, outputTokens: checkResult.usage.outputTokens },
        { roleId: this.id });
      if (report.passed) {
        events.push({ eventType: "accessibility.passed", payload: { skillsRun: report.skillsRun, issueCount: report.issues.length } });
      } else {
        const criticalCount = report.issues.filter((i) => i.severity === "critical").length;
        events.push({ eventType: "accessibility.failed", payload: { critical: criticalCount, total: report.issues.length, issues: report.issues } });
      }
      events.push({ eventType: "accessibility.completed", payload: { passed: report.passed, report } });
      return { events, diff: { kind: "none" } };
    } catch (err) {
      events.push({ eventType: "accessibility.errored", payload: { error: (err as Error).message } });
      throw err;
    }
  }
}
