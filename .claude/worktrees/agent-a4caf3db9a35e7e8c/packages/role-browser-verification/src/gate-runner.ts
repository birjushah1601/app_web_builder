import type { GateLayer, GateResult, GateRunInput, GateRunner } from "@atlas/gate-scheduler";
import type { LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { runBrowserCheck } from "./browser-check.js";

export interface BrowserVerificationGateRunnerOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  model?: string;
}

export class BrowserVerificationGateRunner implements GateRunner {
  readonly layer: GateLayer = "L3";
  private readonly opts: BrowserVerificationGateRunnerOptions;
  constructor(opts: BrowserVerificationGateRunnerOptions) {
    this.opts = opts;
  }

  async run(input: GateRunInput): Promise<GateResult> {
    const report = await runBrowserCheck({
      llm: this.opts.llm,
      skills: this.opts.skills,
      diff: "",
      graphSlice: input.graphSlice,
      model: this.opts.model
    });
    const summary = report.passed
      ? `L3 passed — ${report.issues.length} non-critical issues`
      : `L3 failed — ${report.issues.filter((i) => i.severity === "critical").length} critical, ${report.issues.length} total`;
    return {
      layer: "L3",
      status: report.passed ? "passed" : "failed",
      summary,
      issues: report.issues.map((i) => ({
        severity: i.severity,
        message: `[${i.code}] ${i.message}`
      }))
    };
  }
}
