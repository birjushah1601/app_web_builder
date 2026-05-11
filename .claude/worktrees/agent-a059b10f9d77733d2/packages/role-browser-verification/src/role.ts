import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { runBrowserCheck } from "./browser-check.js";

export interface BrowserVerificationRoleOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  model?: string;
}

export class BrowserVerificationRole implements Role {
  readonly id = "browser-verification";
  private readonly opts: BrowserVerificationRoleOptions;
  constructor(opts: BrowserVerificationRoleOptions) {
    this.opts = opts;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    events.push({
      eventType: "browser-verification.started",
      payload: { ritualId: inv.ritualId }
    });

    try {
      const report = await runBrowserCheck({
        llm: this.opts.llm,
        skills: this.opts.skills,
        diff: inv.userTurn,
        graphSlice: inv.graphSlice,
        model: this.opts.model
      });
      if (report.passed) {
        events.push({
          eventType: "browser-verification.passed",
          payload: { skillsRun: report.skillsRun, issueCount: report.issues.length }
        });
      } else {
        const criticalCount = report.issues.filter((i) => i.severity === "critical").length;
        events.push({
          eventType: "browser-verification.failed",
          payload: { critical: criticalCount, total: report.issues.length, issues: report.issues }
        });
      }
      events.push({
        eventType: "browser-verification.completed",
        payload: { passed: report.passed, report }
      });
      return { events, diff: { kind: "none" } };
    } catch (err) {
      events.push({
        eventType: "browser-verification.errored",
        payload: { error: (err as Error).message }
      });
      throw err;
    }
  }
}
