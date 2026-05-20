import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import { InspirationBriefSchema, type DesignIntent, type InspirationBrief } from "./types.js";
import type { CatalogEntry } from "./local-catalog.js";
import type { WebHit } from "./web-fetch.js";
import { ResearcherFailedError } from "./errors.js";

// Plan PFP: model ID must be valid on whichever provider is in use. The
// previous hardcoded "claude-haiku-4-5" is the Anthropic-direct ID and 400s
// on OpenRouter, which expects "anthropic/claude-haiku-4.5" (prefix + dot).
// Operators can override via ATLAS_LLM_RESEARCHER_MODEL; default targets the
// OpenRouter format since atlas-web defaults to OpenRouter via ATLAS_LLM_BASE_URL.
export const RESEARCHER_BRIEF_MODEL =
  process.env.ATLAS_LLM_RESEARCHER_MODEL ?? "anthropic/claude-haiku-4.5";

const ROLE_PROMPT = `You are the Researcher role. Given a designIntent (category +
audience cues), a local-catalog entry (curated references), and optional web-search hits,
produce ONE InspirationBrief that fuses both sources into a single recommendation set.

Rules:
- Cite local-catalog references with sourceTier: "local-catalog"; web hits with sourceTier: "web".
- Prefer 3-5 references total. If you have more, pick the most diverse + relevant.
- Carry over palettePreview / typographyPreview from local entries where present; do NOT invent them for web hits unless visible in the hit description.
- patternsThatWin / patternsThatLose: synthesize from local entry + your knowledge of the category.
- audienceCues: echo the designIntent's cues; do NOT add new ones.

Call the emit_brief tool exactly once.`;

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string" },
    audienceCues: { type: "array", items: { type: "string" } },
    references: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          url: { type: "string" },
          why: { type: "string" },
          sourceTier: { type: "string", enum: ["local-catalog", "web"] },
          palettePreview: { type: "array", items: { type: "string" } },
          typographyPreview: {
            type: "object",
            properties: {
              primary: { type: "string" },
              secondary: { type: "string" }
            },
            required: ["primary"]
          }
        },
        required: ["name", "why", "sourceTier"]
      }
    },
    patternsThatWin: { type: "array", items: { type: "string" } },
    patternsThatLose: { type: "array", items: { type: "string" } }
  },
  required: ["category", "audienceCues", "references", "patternsThatWin", "patternsThatLose"]
} as const;

interface AssembleBriefInput {
  llm: LLMProvider;
  designIntent: DesignIntent;
  localEntry: CatalogEntry | undefined;
  webHits: WebHit[];
}

export async function assembleBrief(input: AssembleBriefInput): Promise<InspirationBrief> {
  const userTurn = renderUserTurn(input);

  const messages: LLMMessage[] = [
    { role: "system", content: ROLE_PROMPT },
    { role: "user", content: userTurn }
  ];

  let result: { toolName: string; input: unknown };
  try {
    result = await (input.llm as unknown as {
      completeWithToolUse: (m: LLMMessage[], o: Record<string, unknown>) => Promise<{ toolName: string; input: unknown }>;
    }).completeWithToolUse(messages, {
      model: RESEARCHER_BRIEF_MODEL,
      maxTokens: 4096,
      tools: [
        {
          name: "emit_brief",
          description: "Emit the InspirationBrief",
          input_schema: TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_brief" }
    });
  } catch (err) {
    throw new ResearcherFailedError(`brief LLM call failed: ${(err as Error).message}`, {
      cause: err,
      category: input.designIntent.category
    });
  }

  const parsed = InspirationBriefSchema.safeParse(result.input);
  if (!parsed.success) {
    throw new ResearcherFailedError(`brief tool_use payload failed schema: ${parsed.error.message}`, {
      cause: parsed.error,
      category: input.designIntent.category
    });
  }
  return parsed.data;
}

function renderUserTurn(input: AssembleBriefInput): string {
  const parts: string[] = [];
  parts.push(`# Design Intent`);
  parts.push(`Category: ${input.designIntent.category}`);
  parts.push(`Audience cues: ${input.designIntent.audienceCues.join(", ") || "(none)"}`);

  if (input.localEntry) {
    parts.push("");
    parts.push("# Local Catalog Entry");
    parts.push("```yaml");
    parts.push(JSON.stringify(input.localEntry, null, 2));
    parts.push("```");
  } else {
    parts.push("");
    parts.push("# Local Catalog Entry");
    parts.push("(no entry for this category — use general principles)");
  }

  if (input.webHits.length > 0) {
    parts.push("");
    parts.push("# Web Search Hits");
    for (const hit of input.webHits) {
      parts.push(`- **${hit.title}** — ${hit.url}`);
      parts.push(`  ${hit.description}`);
    }
  }

  parts.push("");
  parts.push("Now produce the InspirationBrief via the emit_brief tool.");
  return parts.join("\n");
}
