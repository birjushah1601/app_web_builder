import type { LLMMessage, LLMProvider } from "@atlas/llm-provider";
import type { InspirationBrief, DesignIntent } from "@atlas/role-researcher";
import { DesignProposalSchema, DesignDirectionSchema, type DesignProposal } from "./types.js";
export { DesignDirectionSchema };
import { DesignerFailedError } from "./errors.js";

export const DESIGNER_PROPOSAL_MODEL = "claude-sonnet-4";

/** Categories where componentSet defaults to radix-bare instead of shadcn.
 *  These are marketing/content surfaces where shadcn's slate+blue defaults
 *  drive every output toward sameness. App surfaces (dashboards, admin,
 *  saas-app) still use shadcn because their primitives are valuable. */
export const MARKETING_CATEGORIES: ReadonlySet<string> = new Set([
  "saas-marketing",
  "restaurant-landing",
  "portfolio-personal",
  "e-commerce-product",
  "agency-creative",
  "real-estate-listing",
  "fitness-wellness-landing",
  "blog-publishing",
  "travel-booking",
  "education-marketing",
  "ngo-marketing"
]);

export const DRAFT_SYSTEM_PROMPT = `You are the Designer role. Given a designIntent (category + audience cues),
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
- componentSet selection rule (decide based on the brief's \`category\` field):
  - "shadcn"     → app surfaces and tools (saas-app, dashboard, admin, internal-tools, productivity-app)
  - "radix-bare" → marketing/content surfaces (saas-marketing, restaurant-landing, portfolio-personal, e-commerce-product, agency-creative, real-estate-listing, fitness-wellness-landing, blog-publishing, travel-booking, education-marketing, ngo-marketing)
  - "custom"     → premium-distinctive brands explicitly asking for hand-crafted components

  Default to shadcn ONLY when the category doesn't match any marketing/content listing above. The radix-bare rule prevents shadcn's slate+blue defaults from drowning out the chosen palette on marketing pages.
- copyVoice MUST match audienceCues (premium <-> fine-dining; friendly <-> family-cafe; authoritative <-> enterprise; playful <-> consumer).

Each direction you emit MUST include a \`layoutDirective\` field — 1-3 sentences naming the specific sections the page should have AND any explicit exclusions (e.g., "NO testimonials block — restaurants don't lead with reviews"). The layoutDirective is what the Developer uses as the page skeleton. Generic "hero + features + footer" directives defeat the purpose — be category-specific. Examples:

- Restaurant: "Hero with food close-up + reservation chip overlay. Menu by category with photos. Chef portrait + story. Visit info (hours, map). NO testimonials — restaurants lead with the food."
- API docs: "Hero with live code snippet + language switcher. Quickstart in 4 steps. Method gallery (clickable cards). Integration logos."
- Marketplace: "Search-first hero (location/date/category). Featured listings grid. Trust strip (reviews, listing count). Categories cloud."
- Portfolio: "Full-bleed hero with one signature work. Project gallery (large tiles). About + process section. Contact CTA."

If the user's prompt doesn't match a clear category, INFER one and commit to it. Two restaurant sites should not get the same layoutDirective — vary based on cuisine, formality, target audience.

Call the emit_proposal tool exactly once.`;

// Keep backward-compatible alias used internally
const ROLE_PROMPT = DRAFT_SYSTEM_PROMPT;

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
    tokens: TOKENS_SCHEMA,
    layoutDirective: { type: "string", minLength: 20 }
  },
  required: ["id", "name", "shortDescription", "technicalDescription", "citedReferences", "tokens", "layoutDirective"]
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

function formatPaletteAnchor(brief: InspirationBrief): string {
  const top = brief.references[0];
  if (!top) return "(no references available)";
  const palette = top.palettePreview;
  if (!palette || palette.length === 0) {
    return `Top reference: ${top.name}\n(no palette preview available — invent a palette from category conventions)`;
  }
  // Label by position: 4-tuple → surface/text/accent/muted; 3-tuple → surface/text/accent
  const labels =
    palette.length >= 4
      ? ["surface", "text", "accent", "muted"]
      : ["surface", "text", "accent"];
  const rows = palette.slice(0, labels.length).map((hex, i) => `  ${labels[i]}: ${hex}`).join("\n");
  return [
    `Top reference: ${top.name}`,
    `Suggested palette to anchor from:`,
    rows
  ].join("\n");
}

export function renderDraftUserTurn(brief: InspirationBrief, userPrompt: string): string {
  return [
    "## Palette anchors (from researcher's top reference)",
    "",
    formatPaletteAnchor(brief),
    "",
    "You can shift hues, saturation, or contrast — but stay within ±15% of these values unless your direction has a strong category reason. If your direction diverges from this anchor, EXPLAIN WHY in that direction's `technicalDescription` field.",
    "",
    "Alternates can (and should) anchor on the second and third references' palettes for visible differentiation across the three directions.",
    "",
    "## Brief",
    JSON.stringify(brief, null, 2),
    "",
    "## User prompt",
    userPrompt
  ].join("\n");
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
