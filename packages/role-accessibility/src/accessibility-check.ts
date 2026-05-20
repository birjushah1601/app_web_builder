import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { assembleAccessibilityPrompt } from "./assemble-prompt.js";
import { AccessibilityCheckFailedError } from "./errors.js";
import { AccessibilityReportSchema, type AccessibilityReport } from "./types.js";

export const ACCESSIBILITY_MODEL = "claude-sonnet-4-6";

const ACCESSIBILITY_TOOL_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          code: { type: "string" },
          message: { type: "string" },
          file: { type: "string" },
          line: { type: "number" }
        },
        required: ["severity", "code", "message"]
      }
    },
    skillsRun: { type: "array", items: { type: "string" } }
  },
  required: ["passed", "issues", "skillsRun"]
} as const;

export interface AccessibilityCheckInput {
  llm: LLMProvider;
  skills: SkillRegistry;
  diff: string;
  graphSlice: { bytes: string; hash: string };
  model?: string;
}

export async function runAccessibilityCheck(input: AccessibilityCheckInput): Promise<AccessibilityReport> {
  const skillPrompt = assembleAccessibilityPrompt(input.skills, ["wcag-audit", "rtl-layout", "keyboard-nav", "contrast-check"]);
  const systemPrompt = `You are the Atlas L5 Accessibility gate. Run the 4 accessibility skills over the proposed diff + graph slice. Emit an AccessibilityReport via the emit_accessibility_report tool. Any critical issue forces passed=false.\n\n${skillPrompt}`;
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt, cache_control: { type: "ephemeral" } },
    { role: "system", content: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>` },
    { role: "user", content: `=== Proposed diff ===\n${input.diff}` }
  ];
  let result;
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: input.model ?? ACCESSIBILITY_MODEL,
      maxTokens: 4096,
      tools: [{ name: "emit_accessibility_report", description: "Emit the L5 accessibility gate report", input_schema: ACCESSIBILITY_TOOL_SCHEMA }],
      toolChoice: { type: "tool", name: "emit_accessibility_report" }
    });
  } catch (err) {
    throw new AccessibilityCheckFailedError("accessibility LLM call failed", { cause: err });
  }
  const parse = AccessibilityReportSchema.safeParse(result.input);
  if (!parse.success) {
    console.error("[role-accessibility] tool_use payload:", JSON.stringify(result.input).slice(0, 800));
    console.error("[role-accessibility] zod issues:    ", JSON.stringify(parse.error.issues));
    throw new AccessibilityCheckFailedError("accessibility tool_use payload failed schema", { cause: parse.error });
  }
  return parse.data;
}
