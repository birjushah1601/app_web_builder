import type { GateLayer, GateResult, GateRunInput, GateRunner } from "@atlas/gate-scheduler";
import type { LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { runAccessibilityCheck } from "./accessibility-check.js";

export interface AccessibilityGateRunnerOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  model?: string;
}

export class AccessibilityGateRunner implements GateRunner {
  readonly layer: GateLayer = "L5";
  private readonly opts: AccessibilityGateRunnerOptions;
  constructor(opts: AccessibilityGateRunnerOptions) { this.opts = opts; }

  async run(input: GateRunInput): Promise<GateResult> {
    const report = await runAccessibilityCheck({
      llm: this.opts.llm,
      skills: this.opts.skills,
      diff: "",
      graphSlice: input.graphSlice,
      model: this.opts.model
    });
    const summary = report.passed
      ? `L5 passed — ${report.issues.length} non-critical issues`
      : `L5 failed — ${report.issues.filter((i) => i.severity === "critical").length} critical, ${report.issues.length} total`;
    return {
      layer: "L5",
      status: report.passed ? "passed" : "failed",
      summary,
      issues: report.issues.map((i) => ({ severity: i.severity, message: `[${i.code}] ${i.message}` }))
    };
  }
}
