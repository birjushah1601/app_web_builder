import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { InspirationBrief, DesignIntent } from "@atlas/role-researcher";
import { DesignProposalSchema, type DesignProposal } from "./types.js";
import { DesignerFailedError } from "./errors.js";

export const DESIGNER_PROPOSAL_MODEL = "claude-sonnet-4";

const ROLE_PROMPT = `You are the Designer role. Given a designIntent (category + audience cues),
an architect artifact (scope + structure), and an optional InspirationBrief
(curated references + patterns that win/lose for this category), produce
ONE DesignProposal containing exactly one recommended DesignDirection and
exactly two alternate DesignDirections.

Each DesignDirection MUST include:
- A short id (kebab-case, e.g. "editorial-dark", "modern-minimal", "warm-earthen").
- A human-readable name.
- A shortDescription (one sentence, jargon-free — for non-technical readers).
- A technicalDescription (one sentence, terse, names font + density + accent — for builders).
- citedReferences: 1-3 names from the InspirationBrief's references list. If no brief, use [].
- A complete DesignTokens object (palette / typeScale / density / componentSet / imageryStrategy / copyVoice).

Rules:
- The recommended direction MUST cite the brief's strongest reference and explain why in the reasoning field.
- The two alternates MUST be meaningfully different from the recommendation (not just palette swaps).
- Palette colors MUST be valid hex (#RRGGBB).
- typeScale.sansFamily and monoFamily are required; serifFamily is optional.
- baseSizePx between 14 and 18 for body text (16 is the safe default).
- Pick density based on category: marketing/editorial = spacious; dashboards/admin = compact; app surfaces = comfortable.
- Pick componentSet = shadcn unless the brief explicitly suggests otherwise.
- copyVoice MUST match audienceCues (premium <-> fine-dining; friendly <-> family-cafe; authoritative <-> enterprise; playful <-> consumer).

Call the emit_proposal tool exactly once.`;

const TOKENS_SCHEMA = {
  type: "object",
  properties: {
    palette: {
      type: "object",
      properties: {
        primary: { type: "string" },
        accent: { type: "string" },
        surface: { type: "string" },
        text: { type: "string" },
        muted: { type: "string" }
      },
      required: ["primary", "accent", "surface", "text", "muted"]
    },
    typeScale: {
      type: "object",
      properties: {
        sansFamily: { type: "string" },
        serifFamily: { type: "string" },
        monoFamily: { type: "string" },
        baseSizePx: { type: "number" },
        scale: { type: "string", enum: ["minor-third", "major-third", "perfect-fourth"] }
      },
      required: ["sansFamily", "monoFamily", "baseSizePx", "scale"]
    },
    density: { type: "string", enum: ["compact", "comfortable", "spacious"] },
    componentSet: { type: "string", enum: ["shadcn", "radix-bare", "custom"] },
    imageryStrategy: { type: "string", enum: ["photo", "illustration", "abstract-gradients", "none"] },
    copyVoice: { type: "string", enum: ["premium", "friendly", "authoritative", "playful"] }
  },
  required: ["palette", "typeScale", "density", "componentSet", "imageryStrategy", "copyVoice"]
} as const;

const DIRECTION_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    shortDescription: { type: "string" },
    technicalDescription: { type: "string" },
    citedReferences: { type: "array", items: { type: "string" } },
    tokens: TOKENS_SCHEMA
  },
  required: ["id", "name", "shortDescription", "technicalDescription", "citedReferences", "tokens"]
} as const;

export const PROPOSAL_TOOL_SCHEMA = {
  type: "object",
  properties: {
    recommended: DIRECTION_SCHEMA,
    alternates: {
      type: "array",
      items: DIRECTION_SCHEMA,
      minItems: 2,
      maxItems: 2
    },
    reasoning: { type: "string" }
  },
  required: ["recommended", "alternates", "reasoning"]
} as const;

export interface AssembleProposalInput {
  llm: LLMProvider;
  designIntent: DesignIntent;
  brief: InspirationBrief | null;
  architectArtifact: unknown;
}

export async function assembleProposal(input: AssembleProposalInput): Promise<DesignProposal> {
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
      model: DESIGNER_PROPOSAL_MODEL,
      maxTokens: 8192,
      tools: [
        {
          name: "emit_proposal",
          description: "Emit the DesignProposal (1 recommended + 2 alternates + reasoning)",
          input_schema: PROPOSAL_TOOL_SCHEMA
        }
      ],
      toolChoice: { type: "tool", name: "emit_proposal" }
    });
  } catch (err) {
    throw new DesignerFailedError(`proposal LLM call failed: ${(err as Error).message}`, {
      cause: err,
      reason: "llm-error"
    });
  }

  const parsed = DesignProposalSchema.safeParse(result.input);
  if (!parsed.success) {
    throw new DesignerFailedError(`tool_use payload failed schema: ${parsed.error.message}`, {
      cause: parsed.error,
      reason: "schema-mismatch"
    });
  }
  return parsed.data;
}

function renderUserTurn(input: AssembleProposalInput): string {
  const parts: string[] = [];
  parts.push(`# Design Intent`);
  parts.push(`Category: ${input.designIntent.category}`);
  parts.push(`Audience cues: ${input.designIntent.audienceCues.join(", ") || "(none)"}`);

  parts.push("");
  parts.push("# Architect Artifact");
  parts.push("```json");
  parts.push(JSON.stringify(input.architectArtifact, null, 2));
  parts.push("```");

  if (input.brief) {
    parts.push("");
    parts.push("# Inspiration Brief");
    parts.push("```json");
    parts.push(JSON.stringify(input.brief, null, 2));
    parts.push("```");
  } else {
    parts.push("");
    parts.push("# Inspiration Brief");
    parts.push("(no inspiration brief available — use general principles for the category)");
  }

  parts.push("");
  parts.push("Now produce the DesignProposal via the emit_proposal tool.");
  return parts.join("\n");
}
