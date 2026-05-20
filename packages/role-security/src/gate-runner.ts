import type { GateLayer, GateResult, GateRunInput, GateRunner } from "@atlas/gate-scheduler";
import type { LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { runSecurityCheck } from "./security-check.js";

export interface SecurityGateRunnerOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  model?: string;
}

export class SecurityGateRunner implements GateRunner {
  readonly layer: GateLayer = "L4";
  private readonly opts: SecurityGateRunnerOptions;
  constructor(opts: SecurityGateRunnerOptions) { this.opts = opts; }

  async run(input: GateRunInput): Promise<GateResult> {
    const report = await runSecurityCheck({
      llm: this.opts.llm,
      skills: this.opts.skills,
      diff: "",
      graphSlice: input.graphSlice,
      model: this.opts.model
    });
    const summary = report.passed
      ? `L4 passed — ${report.issues.length} non-critical issues`
      : `L4 failed — ${report.issues.filter((i) => i.severity === "critical").length} critical, ${report.issues.length} total`;
    return {
      layer: "L4",
      status: report.passed ? "passed" : "failed",
      summary,
      issues: report.issues.map((i) => ({ severity: i.severity, message: `[${i.code}] ${i.message}` }))
    };
  }
}
