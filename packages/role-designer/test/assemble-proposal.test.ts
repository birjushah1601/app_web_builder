import { describe, it, expect, vi } from "vitest";
import { assembleProposal, DESIGNER_PROPOSAL_MODEL, DesignDirectionSchema, renderDraftUserTurn, MARKETING_CATEGORIES, DRAFT_SYSTEM_PROMPT } from "../src/assemble-proposal.js";
import { DesignProposalSchema } from "../src/types.js";
import type { InspirationBrief } from "@atlas/role-researcher";
import { DesignerFailedError } from "../src/errors.js";

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_proposal", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const tokens = {
  palette: { primary: "#0a0a0a", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
  typeScale: { sansFamily: "Inter", serifFamily: "IBM Plex Serif", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
  density: "spacious",
  componentSet: "shadcn",
  imageryStrategy: "photo",
  copyVoice: "premium"
};

const direction = (id: string, refs: string[] = []) => ({
  id,
  name: id,
  shortDescription: `${id} short`,
  technicalDescription: `${id} technical`,
  citedReferences: refs,
  layoutDirective: "Hero with food. Menu by category. NO testimonials.",
  tokens
});

const validProposalReply = {
  recommended: direction("editorial-dark", ["Bombay Canteen"]),
  alternates: [direction("modern-minimal", ["Linear"]), direction("warm-earthen", ["Bombay Canteen"])],
  reasoning: "Recommended editorial-dark because it cites Bombay Canteen — strongest match for the premium-restaurant signal in audienceCues."
};

const sampleBrief: InspirationBrief = {
  category: "restaurant-landing",
  audienceCues: ["fine-dining"],
  references: [
    {
      name: "Bombay Canteen",
      url: "https://thebombaycanteen.com",
      why: "Editorial serif headlines",
      sourceTier: "local-catalog",
      palettePreview: ["#0a0a0a", "#fbbf24"],
      typographyPreview: { primary: "IBM Plex Serif" }
    }
  ],
  patternsThatWin: ["above-the-fold reservation CTA"],
  patternsThatLose: ["stock photo carousels"]
};

describe("assembleProposal", () => {
  it("returns a Zod-valid DesignProposal on happy path", async () => {
    const llm = fakeLLM(validProposalReply);
    const proposal = await assembleProposal({
      llm: llm as never,
      designIntent: { category: "restaurant-landing", audienceCues: ["fine-dining"] },
      brief: sampleBrief,
      architectArtifact: { scope: "frontend-landing", graphSlice: { bytes: "{}", hash: "h" } }
    });
    expect(DesignProposalSchema.safeParse(proposal).success).toBe(true);
    expect(proposal.recommended.id).toBe("editorial-dark");
    expect(proposal.alternates).toHaveLength(2);
  });

  it("invokes the LLM with tool-use shape using DESIGNER_PROPOSAL_MODEL", async () => {
    const llm = fakeLLM(validProposalReply);
    await assembleProposal({
      llm: llm as never,
      designIntent: { category: "restaurant-landing", audienceCues: [] },
      brief: sampleBrief,
      architectArtifact: { scope: "frontend-landing", graphSlice: { bytes: "{}", hash: "h" } }
    });
    expect((llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse).toHaveBeenCalledOnce();
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const opts = args[1] as { model: string; tools: Array<{ name: string }>; toolChoice?: unknown };
    expect(opts.model).toBe(DESIGNER_PROPOSAL_MODEL);
    expect(opts.tools[0].name).toBe("emit_proposal");
  });

  it("includes brief references + patterns in the user-turn message", async () => {
    const llm = fakeLLM(validProposalReply);
    await assembleProposal({
      llm: llm as never,
      designIntent: { category: "restaurant-landing", audienceCues: ["fine-dining"] },
      brief: sampleBrief,
      architectArtifact: { scope: "frontend-landing", graphSlice: { bytes: "{}", hash: "h" } }
    });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ content: string }>;
    const userMsg = messages.find((m) => m.content?.includes("Bombay Canteen"));
    expect(userMsg).toBeDefined();
    expect(userMsg?.content).toContain("above-the-fold reservation CTA");
    expect(userMsg?.content).toContain("stock photo carousels");
  });

  it("works when brief is null (graceful degrade)", async () => {
    const llm = fakeLLM(validProposalReply);
    const proposal = await assembleProposal({
      llm: llm as never,
      designIntent: { category: "battle-mech-configurator", audienceCues: [] },
      brief: null,
      architectArtifact: { scope: "frontend-landing", graphSlice: { bytes: "{}", hash: "h" } }
    });
    expect(DesignProposalSchema.safeParse(proposal).success).toBe(true);
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ content: string }>;
    const userMsg = messages.find((m) => /no inspiration brief|general principles/i.test(m.content ?? ""));
    expect(userMsg).toBeDefined();
  });

  it("throws DesignerFailedError on schema mismatch (only 1 alternate)", async () => {
    const bad = {
      recommended: direction("a"),
      alternates: [direction("b")], // only 1 — schema requires exactly 2
      reasoning: "x"
    };
    const llm = fakeLLM(bad);
    await expect(
      assembleProposal({
        llm: llm as never,
        designIntent: { category: "x", audienceCues: [] },
        brief: null,
        architectArtifact: { scope: "frontend-landing", graphSlice: { bytes: "{}", hash: "h" } }
      })
    ).rejects.toThrow(DesignerFailedError);
  });

  it("throws DesignerFailedError on LLM failure", async () => {
    const llm = {
      completeWithToolUse: vi.fn().mockRejectedValue(new Error("LLM 503"))
    } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> };
    await expect(
      assembleProposal({
        llm: llm as never,
        designIntent: { category: "x", audienceCues: [] },
        brief: null,
        architectArtifact: { scope: "frontend-landing", graphSlice: { bytes: "{}", hash: "h" } }
      })
    ).rejects.toThrow(DesignerFailedError);
  });
});

describe("DesignDirectionSchema layoutDirective", () => {
  it("rejects a direction missing layoutDirective", () => {
    const sample = {
      id: "x",
      name: "x",
      shortDescription: "x",
      technicalDescription: "x",
      citedReferences: [],
      tokens: {
        palette: { primary: "#000", accent: "#fff", surface: "#fff", text: "#000", muted: "#888" },
        typeScale: { sansFamily: "Inter", serifFamily: "Georgia", monoFamily: "Mono", baseSizePx: 16, scale: "major-third" },
        density: "comfortable",
        componentSet: "shadcn",
        imageryStrategy: "photo",
        copyVoice: "friendly"
      }
      // layoutDirective intentionally omitted
    };
    const result = DesignDirectionSchema.safeParse(sample);
    expect(result.success).toBe(false);
  });

  it("accepts a direction with a non-empty layoutDirective string", () => {
    const sample = {
      id: "x",
      name: "x",
      shortDescription: "x",
      technicalDescription: "x",
      citedReferences: [],
      tokens: {
        palette: { primary: "#000", accent: "#fff", surface: "#fff", text: "#000", muted: "#888" },
        typeScale: { sansFamily: "Inter", serifFamily: "Georgia", monoFamily: "Mono", baseSizePx: 16, scale: "major-third" },
        density: "comfortable",
        componentSet: "shadcn",
        imageryStrategy: "photo",
        copyVoice: "friendly"
      },
      layoutDirective: "Hero + features + testimonials"
    };
    const result = DesignDirectionSchema.safeParse(sample);
    expect(result.success).toBe(true);
  });
});

describe("renderDraftUserTurn palette anchors", () => {
  it("prepends a palette anchor block citing the top reference", () => {
    const brief = {
      category: "restaurant-landing",
      audienceCues: ["foodies"],
      references: [
        {
          name: "Bombay Canteen",
          url: "x",
          why: "x",
          sourceTier: "web" as const,
          palettePreview: ["#fef3c7", "#0a0a0a", "#fbbf24"]
        }
      ],
      patternsThatWin: ["chef portrait"],
      patternsThatLose: ["fake testimonials"]
    };
    const out = renderDraftUserTurn(brief, "build a restaurant site");
    expect(out).toContain("Palette anchor");
    expect(out).toContain("Bombay Canteen");
    expect(out).toContain("#fef3c7");
    expect(out).toContain("#0a0a0a");
    expect(out).toContain("#fbbf24");
  });

  it("renders a no-anchor fallback when the top reference lacks palettePreview", () => {
    const brief = {
      category: "x",
      audienceCues: [],
      references: [{ name: "Generic", url: "x", why: "x", sourceTier: "web" as const }],
      patternsThatWin: [],
      patternsThatLose: []
    };
    const out = renderDraftUserTurn(brief, "x");
    expect(out).toContain("no palette preview available");
  });
});

describe("componentSet category rule", () => {
  it("MARKETING_CATEGORIES includes the expected 11 categories", () => {
    expect(MARKETING_CATEGORIES.has("restaurant-landing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("saas-marketing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("portfolio-personal")).toBe(true);
    expect(MARKETING_CATEGORIES.has("e-commerce-product")).toBe(true);
    expect(MARKETING_CATEGORIES.has("agency-creative")).toBe(true);
    expect(MARKETING_CATEGORIES.has("real-estate-listing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("fitness-wellness-landing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("blog-publishing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("travel-booking")).toBe(true);
    expect(MARKETING_CATEGORIES.has("education-marketing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("ngo-marketing")).toBe(true);
    expect(MARKETING_CATEGORIES.has("saas-app")).toBe(false);
    expect(MARKETING_CATEGORIES.has("dashboard")).toBe(false);
  });

  it("DRAFT_SYSTEM_PROMPT explains the radix-bare-for-marketing rule", () => {
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/radix-bare/);
    expect(DRAFT_SYSTEM_PROMPT).toMatch(/marketing.*content|content.*marketing/i);
  });
});
