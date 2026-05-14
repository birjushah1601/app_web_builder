import { describe, it, expect, vi } from "vitest";
import { DesignerRole } from "../src/role.js";

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
  shortDescription: "x",
  technicalDescription: "y",
  citedReferences: refs,
  layoutDirective: "Hero with food. Menu by category. NO testimonials.",
  tokens
});

const validProposalReply = {
  recommended: direction("editorial-dark", ["Bombay Canteen"]),
  alternates: [direction("modern-minimal"), direction("warm-earthen")],
  reasoning: "x"
};

const fakeLLM = (toolReply: unknown) =>
  ({
    completeWithToolUse: vi.fn().mockResolvedValue({ toolName: "emit_proposal", input: toolReply })
  } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> });

describe("DesignerRole", () => {
  it("has id 'designer'", () => {
    const role = new DesignerRole({ llm: fakeLLM(validProposalReply) as never });
    expect(role.id).toBe("designer");
  });

  it("happy path: brief + designIntent in priorArtifact -> proposal in events", async () => {
    const llm = fakeLLM(validProposalReply);
    const role = new DesignerRole({ llm: llm as never });
    const out = await role.run({
      ritualId: "r1",
      intent: "build a restaurant landing",
      userTurn: "build a restaurant landing",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        designIntent: { category: "restaurant-landing", audienceCues: ["fine-dining"] },
        brief: {
          category: "restaurant-landing",
          audienceCues: ["fine-dining"],
          references: [{ name: "Bombay Canteen", why: "x", sourceTier: "local-catalog" }],
          patternsThatWin: [],
          patternsThatLose: []
        },
        architectArtifact: { scope: "frontend-landing" }
      }
    });
    const completed = out.events.find((e) => e.eventType === "designer.proposal.completed");
    expect(completed).toBeDefined();
    const payload = completed?.payload as { proposal?: { recommended: { id: string } } };
    expect(payload?.proposal?.recommended.id).toBe("editorial-dark");
    expect(out.diff).toEqual({ kind: "none" });
  });

  it("emits designer.proposal.started before completed", async () => {
    const llm = fakeLLM(validProposalReply);
    const role = new DesignerRole({ llm: llm as never });
    const out = await role.run({
      ritualId: "r1",
      intent: "x",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: { designIntent: { category: "x", audienceCues: [] }, brief: null, architectArtifact: {} }
    });
    const types = out.events.map((e) => e.eventType);
    expect(types[0]).toBe("designer.proposal.started");
    expect(types).toContain("designer.proposal.completed");
  });

  it("works when brief is missing in priorArtifact (graceful degrade)", async () => {
    const llm = fakeLLM(validProposalReply);
    const role = new DesignerRole({ llm: llm as never });
    const out = await role.run({
      ritualId: "r1",
      intent: "x",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        designIntent: { category: "battle-mech-configurator", audienceCues: [] },
        architectArtifact: { scope: "frontend-landing" }
        // no brief field
      }
    });
    const completed = out.events.find((e) => e.eventType === "designer.proposal.completed");
    expect(completed).toBeDefined();
  });

  it("emits designer.proposal.skipped when designIntent missing", async () => {
    const llm = fakeLLM(validProposalReply);
    const role = new DesignerRole({ llm: llm as never });
    const out = await role.run({
      ritualId: "r1",
      intent: "x",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {} // empty — no designIntent
    });
    expect(out.events.find((e) => e.eventType === "designer.proposal.skipped")).toBeDefined();
    expect(out.events.find((e) => e.eventType === "designer.proposal.completed")).toBeUndefined();
  });

  it("LLM error -> designer.proposal.failed event + throws", async () => {
    const llm = {
      completeWithToolUse: vi.fn().mockRejectedValue(new Error("LLM 503"))
    } as unknown as { completeWithToolUse: (...args: unknown[]) => Promise<unknown> };
    const role = new DesignerRole({ llm: llm as never });
    await expect(
      role.run({
        ritualId: "r1",
        intent: "x",
        userTurn: "x",
        graphSlice: { bytes: "{}", hash: "h" },
        priorArtifact: {
          designIntent: { category: "x", audienceCues: [] },
          brief: null,
          architectArtifact: {}
        }
      })
    ).rejects.toThrow();
  });

  it("does NOT pass persona to the LLM (proposal is persona-agnostic)", async () => {
    const llm = fakeLLM(validProposalReply);
    const role = new DesignerRole({ llm: llm as never });
    await role.run({
      ritualId: "r1",
      intent: "x",
      userTurn: "x",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        designIntent: { category: "restaurant-landing", audienceCues: [] },
        brief: null,
        architectArtifact: {},
        persona: "ama" // present in priorArtifact but should NOT reach the LLM
      }
    });
    const args = (llm as { completeWithToolUse: ReturnType<typeof vi.fn> }).completeWithToolUse.mock.calls[0];
    const messages = args[0] as Array<{ content: string }>;
    for (const msg of messages) {
      expect(msg.content).not.toMatch(/\bpersona\b/i);
      expect(msg.content).not.toMatch(/\bama\b/);
    }
  });
});
