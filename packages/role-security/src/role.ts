import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { runSecurityCheck } from "./security-check.js";

export interface SecurityRoleOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  model?: string;
}

export class SecurityRole implements Role {
  readonly id = "security";
  private readonly opts: SecurityRoleOptions;
  constructor(opts: SecurityRoleOptions) { this.opts = opts; }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    events.push({ eventType: "security.started", payload: { ritualId: inv.ritualId } });

    try {
      const report = await runSecurityCheck({
        llm: this.opts.llm,
        skills: this.opts.skills,
        diff: inv.userTurn,
        graphSlice: inv.graphSlice,
        model: this.opts.model
      });
      if (report.passed) {
        events.push({ eventType: "security.passed", payload: { skillsRun: report.skillsRun, issueCount: report.issues.length } });
      } else {
        const criticalCount = report.issues.filter((i) => i.severity === "critical").length;
        events.push({ eventType: "security.failed", payload: { critical: criticalCount, total: report.issues.length, issues: report.issues } });
      }
      events.push({ eventType: "security.completed", payload: { passed: report.passed, report } });
      return { events, diff: { kind: "none" } };
    } catch (err) {
      events.push({ eventType: "security.errored", payload: { error: (err as Error).message } });
      throw err;
    }
  }
}
