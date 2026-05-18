import type { LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { captureScreenshots, type SandboxExec } from "./screenshot.js";
import { critiqueScreenshots } from "./critique.js";
import { assembleVisualQualityPrompt } from "./assemble-prompt.js";
import type { VisualQualityReport, DesignTokensSnapshot } from "./types.js";

export interface RunVisualQualityCheckInput {
  llm: LLMProvider;
  skills: SkillRegistry;
  exec: SandboxExec;
  previewUrl: string;
  tokens: DesignTokensSnapshot;
  model?: string;
  skillNames?: string[];
}

const DEFAULT_SKILL_NAMES = ["critique-design-tokens", "critique-hierarchy", "critique-copy"];

export async function runVisualQualityCheck(input: RunVisualQualityCheckInput): Promise<VisualQualityReport> {
  const screenshots = await captureScreenshots({ exec: input.exec, previewUrl: input.previewUrl });
  const composedPrompt = assembleVisualQualityPrompt(input.skills, input.skillNames ?? DEFAULT_SKILL_NAMES);
  return critiqueScreenshots({
    llm: input.llm,
    composedPrompt,
    screenshots,
    tokens: input.tokens,
    ...(input.model !== undefined ? { model: input.model } : {})
  });
}
