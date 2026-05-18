import { describe, it, expect, vi } from "vitest";
import { assembleBrief, RESEARCHER_BRIEF_MODEL } from "../src/assemble-brief.js";
import { InspirationBriefSchema } from "../src/types.js";
import type { CatalogEntry } from "../src/local-catalog.js";
import type { WebHit } from "../src/web-fetch.js";

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_brief", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

const sampleEntry: CatalogEntry = {
  category: "restaurant-landing",
  synonyms: ["cafe-website"],
  references: [
    {
      name: "Bombay Canteen",
      url: "https://thebombaycanteen.com",
      why: "Editorial serif",
      palette: ["#0a0a0a", "#fbbf24"],
      typography: { primary: "IBM Plex Serif" },
      density: "spacious"
    }
  ],
  patternsThatWin: ["above-the-fold reservation CTA"],
  patternsThatLose: ["stock photo carousels"]
};

describe("assembleBrief", () => {
  it("returns a Zod-valid InspirationBrief on happy path", async () => {
    const llm = fakeLLM({
      category: "restaurant-landing",
      audienceCues: ["fine-dining"],
      references: [
        {
          name: "Bombay Canteen",
          url: "https://thebombaycanteen.com",
          why: "Editorial serif",
          sourceTier: "local-catalog",
          palettePreview: ["#0a0a0a", "#fbbf24"],
          typographyPreview: { primary: "IBM Plex Serif" }
        }
      ],
      patternsThatWin: ["above-the-fold reservation CTA"],
      patternsThatLose: ["stock photo carousels"]
    });

    const brief = await assembleBrief({
      llm: llm as never,
      designIntent: { category: "restaurant-landing", audienceCues: ["fine-dining"] },
      localEntry: sampleEntry,
      webHits: []
    });

    expect(InspirationBriefSchema.safeParse(brief).success).toBe(true);
    expect(brief.references[0].sourceTier).toBe("local-catalog");
  });

  it("invokes the LLM with tool-use shape", async () => {
    const llm = fakeLLM({
      category: "x",
      audienceCues: [],
      references: [],
      patternsThatWin: [],
      patternsThatLose: []
    });
    await assembleBrief({
      llm: llm as never,
      designIntent: { category: "x", audienceCues: [] },
      localEntry: undefined,
      webHits: []
    });
    expect((llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse).toHaveBeenCalledOnce();
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const opts = args[1] as { model: string; tools: Array<{ name: string }> };
    expect(opts.model).toBe(RESEARCHER_BRIEF_MODEL);
    expect(opts.tools[0].name).toBe("emit_brief");
  });

  it("rejects when LLM returns malformed payload", async () => {
    const llm = fakeLLM({ totally: "wrong shape" });
    await expect(
      assembleBrief({
        llm: llm as never,
        designIntent: { category: "x", audienceCues: [] },
        localEntry: undefined,
        webHits: []
      })
    ).rejects.toThrow();
  });

  it("includes web hits + local entry in the user-turn message", async () => {
    const llm = fakeLLM({
      category: "x",
      audienceCues: [],
      references: [{ name: "n", why: "y", sourceTier: "web" }],
      patternsThatWin: [],
      patternsThatLose: []
    });
    const webHits: WebHit[] = [{ title: "Linear", url: "https://linear.app", description: "issues" }];
    await assembleBrief({
      llm: llm as never,
      designIntent: { category: "x", audienceCues: [] },
      localEntry: sampleEntry,
      webHits
    });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ content: string }>;
    const userMsg = messages.find((m) => m.content?.includes("Linear"));
    expect(userMsg).toBeDefined();
    expect(userMsg?.content).toContain("Bombay Canteen");
    expect(userMsg?.content).toContain("Linear");
  });
});
