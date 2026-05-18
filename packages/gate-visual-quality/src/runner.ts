import type { LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { runVisualQualityCheck } from "./visual-quality-check.js";
import type { SandboxExec } from "./screenshot.js";
import type { DesignTokensSnapshot, VisualQualityReport } from "./types.js";

export interface VisualQualityGateRunnerOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  exec: SandboxExec;
  previewUrl: string;
  model?: string;
}

export interface GateResult {
  passed: boolean;
  report: VisualQualityReport;
}

export class VisualQualityGateRunner {
  readonly layer = "L7" as const;
  private readonly opts: VisualQualityGateRunnerOptions;
  constructor(opts: VisualQualityGateRunnerOptions) {
    this.opts = opts;
  }

  async run(input: { tokens: DesignTokensSnapshot }): Promise<GateResult> {
    const report = await runVisualQualityCheck({
      llm: this.opts.llm,
      skills: this.opts.skills,
      exec: this.opts.exec,
      previewUrl: this.opts.previewUrl,
      tokens: input.tokens,
      ...(this.opts.model !== undefined ? { model: this.opts.model } : {})
    });
    return { passed: report.passed, report };
  }
}
