import { describe, it, expect, vi } from "vitest";
import { assembleProposal, DESIGNER_PROPOSAL_MODEL } from "../src/assemble-proposal.js";
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
