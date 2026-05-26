// src/rubric.ts
import type { LLMProvider } from "@atlas/llm-provider";
import type { RoleInvocation } from "@atlas/conductor";
import type { StructuralResult, JudgeResult } from "./types.js";

export interface Rubric<TOutput> {
  readonly roleId: string;
  readonly version: string;
  readonly judgeModel?: string;

  structural(output: TOutput, inv: RoleInvocation): StructuralResult;
  judge(output: TOutput, inv: RoleInvocation, llm: LLMProvider): Promise<JudgeResult>;
}
