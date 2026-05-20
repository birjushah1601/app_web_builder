import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import { VisualQualityError } from "./errors.js";
import { VisualQualityReportSchema, type VisualQualityReport, type DesignTokensSnapshot } from "./types.js";
import type { CapturedScreenshots } from "./screenshot.js";

export const VQ_GATE_MODEL = "claude-sonnet-4";

const ROLE_PROMPT = `You are the Visual-Quality merge gate. Given 3 screenshots of a rendered preview (desktop, tablet, mobile)
and the DesignTokens the user explicitly chose, produce ONE VisualQualityReport that flags drift, contrast/hierarchy
problems, and copy issues.

Rules:
- Any "critical" severity issue MUST flip "passed" to false.
- Score 0-100. 90+ = ship; 70-89 = ship with notes; <70 = significant rework.
- Cite element selectors when possible (e.g. "header > h1", "main .hero img").
- Echo the screenshotUrls input verbatim into the output.

Call the emit_visual_quality_report tool exactly once.`;

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean" },
    score: { type: "integer", minimum: 0, maximum: 100 },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["critical", "major", "minor"] },
          category: { type: "string", enum: ["contrast", "alignment", "hierarchy", "copy", "design-token-drift"] },
          message: { type: "string" },
          elementSelector: { type: "string" }
        },
        required: ["severity", "category", "message"]
      }
    },
    screenshotUrls: {
      type: "object",
      properties: {
        desktop: { type: "string" },
        tablet: { type: "string" },
        mobile: { type: "string" }
      },
      required: ["desktop", "tablet", "mobile"]
    }
  },
  required: ["passed", "score", "issues", "screenshotUrls"]
} as const;

export interface CritiqueInput {
  llm: LLMProvider;
  composedPrompt: string;
  screenshots: CapturedScreenshots;
  tokens: DesignTokensSnapshot;
  model?: string;
}

export async function critiqueScreenshots(input: CritiqueInput): Promise<VisualQualityReport> {
  const userContent = buildUserContent(input);

  const messages: LLMMessage[] = [
    { role: "system", content: `${ROLE_PROMPT}\n\n# Reference skills\n\n${input.composedPrompt}` },
    { role: "user", content: userContent as unknown as string }
  ];

  let result: { toolName: string; input: unknown };
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: input.model ?? VQ_GATE_MODEL,
      maxTokens: 4096,
      tools: [
        {
          name: "emit_visual_quality_report",
          description: "Emit the VisualQualityReport for the rendered preview",
          input_schema: TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_visual_quality_report" }
    });
  } catch (err) {
    throw new VisualQualityError(`critique LLM call failed: ${(err as Error).message}`, { cause: err });
  }

  const enriched = enrichReport(result.input, input.screenshots);
  const parsed = VisualQualityReportSchema.safeParse(enriched);
  if (!parsed.success) {
    throw new VisualQualityError(`critique tool_use payload failed schema: ${parsed.error.message}`, { cause: parsed.error });
  }
  return parsed.data;
}

function buildUserContent(input: CritiqueInput): Array<{ type: string; text?: string; source?: { type: string; media_type: string; data: string } }> {
  const tokensJson = JSON.stringify(input.tokens, null, 2);
  return [
    {
      type: "text",
      text: `# Chosen DesignTokens\n\n\`\`\`json\n${tokensJson}\n\`\`\`\n\n# Screenshots\n\nDesktop, then tablet, then mobile.`
    },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: stripDataUrl(input.screenshots.desktop) } },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: stripDataUrl(input.screenshots.tablet) } },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: stripDataUrl(input.screenshots.mobile) } },
    { type: "text", text: "Now produce the VisualQualityReport via emit_visual_quality_report." }
  ];
}

function stripDataUrl(s: string): string {
  return s.replace(/^data:image\/\w+;base64,/, "");
}

function enrichReport(raw: unknown, screenshots: CapturedScreenshots): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const r = raw as Record<string, unknown>;
  // Always overwrite screenshotUrls with the actual captured screenshots — model can't be trusted to echo.
  return { ...r, screenshotUrls: screenshots };
}
