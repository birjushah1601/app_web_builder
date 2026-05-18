import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { assembleBrowserVerificationPrompt } from "./assemble-prompt.js";
import { BrowserCheckFailedError } from "./errors.js";
import { BrowserVerificationReportSchema, type BrowserVerificationReport } from "./types.js";

export const BROWSER_VERIFICATION_MODEL = "claude-sonnet-4-6";

export const BROWSER_SKILLS = [
  "page-load-check",
  "viewport-render-check",
  "console-error-check",
  "network-requests-audit"
] as const;

const BROWSER_TOOL_SCHEMA = {
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

export interface BrowserCheckInput {
  llm: LLMProvider;
  skills: SkillRegistry;
  diff: string;
  graphSlice: { bytes: string; hash: string };
  model?: string;
}

export async function runBrowserCheck(input: BrowserCheckInput): Promise<BrowserVerificationReport> {
  const skillPrompt = assembleBrowserVerificationPrompt(input.skills, [...BROWSER_SKILLS]);
  const systemPrompt = `You are the Atlas L3 Browser Verification gate. Run the 4 browser-verification skills over the proposed diff + graph slice. Emit a BrowserVerificationReport via the emit_browser_verification_report tool. Any critical issue forces passed=false.\n\n${skillPrompt}`;
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt, cache_control: { type: "ephemeral" } },
    { role: "system", content: `<graph-slice hash="${input.graphSlice.hash}">\n${input.graphSlice.bytes}\n</graph-slice>` },
    { role: "user", content: `=== Proposed diff ===\n${input.diff}` }
  ];
  let result;
  try {
    result = await (
      input.llm as unknown as {
        completeWithToolUse: (
          m: LLMMessage[],
          o: Record<string, unknown>
        ) => Promise<{ toolName: string; input: unknown }>;
      }
    ).completeWithToolUse(messages, {
      model: input.model ?? BROWSER_VERIFICATION_MODEL,
      maxTokens: 4096,
      tools: [
        {
          name: "emit_browser_verification_report",
          description: "Emit the L3 browser verification gate report",
          input_schema: BROWSER_TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_browser_verification_report" }
    });
  } catch (err) {
    throw new BrowserCheckFailedError("browser-verification LLM call failed", { cause: err });
  }
  const parse = BrowserVerificationReportSchema.safeParse(result.input);
  if (!parse.success) {
    throw new BrowserCheckFailedError("browser-verification tool_use payload failed schema", {
      cause: parse.error
    });
  }
  return parse.data;
}
