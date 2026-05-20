import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { assembleSecurityPrompt } from "./assemble-prompt.js";
import { SecurityCheckFailedError } from "./errors.js";
import { SecurityReportSchema, type SecurityReport } from "./types.js";

export const SECURITY_MODEL = "claude-opus-4-7";

const SECURITY_TOOL_SCHEMA = {
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

export interface SecurityCheckInput {
  llm: LLMProvider;
  skills: SkillRegistry;
  diff: string;
  graphSlice: { bytes: string; hash: string };
  model?: string;
}

export async function runSecurityCheck(input: SecurityCheckInput): Promise<SecurityReport> {
  const skillPrompt = assembleSecurityPrompt(input.skills, ["audit-rls", "cors-policy", "secrets-scan", "cve-check"]);
  const systemPrompt = `You are the Atlas L4 Security gate. Run the 4 security skills over the proposed diff + graph slice. Emit a SecurityReport via the emit_security_report tool. Any critical issue forces passed=false.\n\n${skillPrompt}`;
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
      model: input.model ?? SECURITY_MODEL,
      maxTokens: 4096,
      tools: [{ name: "emit_security_report", description: "Emit the L4 security gate report", input_schema: SECURITY_TOOL_SCHEMA }],
      toolChoice: { type: "tool", name: "emit_security_report" }
    });
  } catch (err) {
    throw new SecurityCheckFailedError("security LLM call failed", { cause: err });
  }
  const parse = SecurityReportSchema.safeParse(result.input);
  if (!parse.success) throw new SecurityCheckFailedError("security tool_use payload failed schema", { cause: parse.error });
  return parse.data;
}
