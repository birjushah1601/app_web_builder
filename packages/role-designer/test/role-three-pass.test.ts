import { describe, it, expect } from "vitest";
import { DesignerRole } from "../src/role.js";

describe("DesignerRole — three-pass when ATLAS_FF_DESIGNER_CRITIQUE=true", () => {
  it("calls draftProposal then critiqueDraft then reviseDraft in order", async () => {
    const calls: string[] = [];
    const llm = {
      completeWithToolUse: async (_msgs: unknown, opts: { tools?: Array<{ name: string }> }) => {
        const toolName = opts.tools?.[0]?.name ?? "unknown";
        calls.push(toolName);
        if (toolName === "emit_proposal") {
          return {
            toolName: "emit_proposal",
            input: {
              recommended: {
                id: "draft-1",
                name: "Draft 1",
                shortDescription: "x",
                technicalDescription: "y",
                citedReferences: [],
                tokens: {
                  palette: { primary: "#000000", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
                  typeScale: { sansFamily: "Inter", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
                  density: "spacious",
                  componentSet: "shadcn",
                  imageryStrategy: "photo",
                  copyVoice: "premium"
                }
              },
              alternates: [
                {
                  id: "alt-a",
                  name: "Alt A",
                  shortDescription: "a",
                  technicalDescription: "b",
                  citedReferences: [],
                  tokens: {
                    palette: { primary: "#111111", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
                    typeScale: { sansFamily: "Inter", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
                    density: "spacious",
                    componentSet: "shadcn",
                    imageryStrategy: "photo",
                    copyVoice: "premium"
                  }
                },
                {
                  id: "alt-b",
                  name: "Alt B",
                  shortDescription: "a",
                  technicalDescription: "b",
                  citedReferences: [],
                  tokens: {
                    palette: { primary: "#222222", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
                    typeScale: { sansFamily: "Inter", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
                    density: "spacious",
                    componentSet: "shadcn",
                    imageryStrategy: "photo",
                    copyVoice: "premium"
                  }
                }
              ],
              reasoning: "draft reasoning"
            }
          };
        }
        if (toolName === "emit_critique") {
          return {
            toolName: "emit_critique",
            input: { findings: [{ axis: "palette", score: 2, suggestion: "more ambition" }] }
          };
        }
        if (toolName === "emit_revised_proposal") {
          return {
            toolName: "emit_revised_proposal",
            input: {
              recommended: {
                id: "final-1",
                name: "Final 1",
                shortDescription: "x",
                technicalDescription: "y",
                citedReferences: [],
                tokens: {
                  palette: { primary: "#FF0000", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
                  typeScale: { sansFamily: "Inter", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
                  density: "spacious",
                  componentSet: "shadcn",
                  imageryStrategy: "photo",
                  copyVoice: "premium"
                }
              },
              alternates: [
                {
                  id: "alt-a-revised",
                  name: "Alt A",
                  shortDescription: "a",
                  technicalDescription: "b",
                  citedReferences: [],
                  tokens: {
                    palette: { primary: "#111111", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
                    typeScale: { sansFamily: "Inter", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
                    density: "spacious",
                    componentSet: "shadcn",
                    imageryStrategy: "photo",
                    copyVoice: "premium"
                  }
                },
                {
                  id: "alt-b-revised",
                  name: "Alt B",
                  shortDescription: "a",
                  technicalDescription: "b",
                  citedReferences: [],
                  tokens: {
                    palette: { primary: "#222222", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
                    typeScale: { sansFamily: "Inter", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
                    density: "spacious",
                    componentSet: "shadcn",
                    imageryStrategy: "photo",
                    copyVoice: "premium"
                  }
                }
              ],
              reasoning: "revised reasoning"
            }
          };
        }
        throw new Error(`unexpected tool: ${toolName}`);
      }
    };
    process.env.ATLAS_FF_DESIGNER_CRITIQUE = "true";
    try {
      const role = new DesignerRole({ llm: llm as never });
      const out = await role.run({
        ritualId: "r1",
        intent: "build a restaurant page",
        userTurn: "build a restaurant page",
        graphSlice: { bytes: "{}", hash: "h" },
        priorArtifact: {
          brief: {
            category: "restaurant-landing",
            audienceCues: ["general"],
            references: [],
            patternsThatWin: [],
            patternsThatLose: []
          },
          designIntent: { category: "restaurant-landing", audienceCues: ["general"] },
          architectArtifact: {}
        }
      });
      expect(calls).toEqual(["emit_proposal", "emit_critique", "emit_revised_proposal"]);
      const finalProposalEvent = out.events.find((e) => e.eventType === "designer.proposal.emitted");
      expect((finalProposalEvent?.payload as { proposal?: { recommended?: { id?: string } } })?.proposal?.recommended?.id).toBe("final-1");

      const types = out.events.map((e) => e.eventType);
      const draftIdx = types.indexOf("designer.draft.completed");
      const critiqueStartedIdx = types.indexOf("designer.critique.started");
      const critiqueCompletedIdx = types.indexOf("designer.critique.completed");
      const reviseStartedIdx = types.indexOf("designer.revise.started");
      const reviseCompletedIdx = types.indexOf("designer.revise.completed");
      const emittedIdx = types.indexOf("designer.proposal.emitted");
      expect(draftIdx).toBeGreaterThanOrEqual(0);
      expect(draftIdx).toBeLessThan(critiqueStartedIdx);
      expect(critiqueStartedIdx).toBeLessThan(critiqueCompletedIdx);
      expect(critiqueCompletedIdx).toBeLessThan(reviseStartedIdx);
      expect(reviseStartedIdx).toBeLessThan(reviseCompletedIdx);
      expect(reviseCompletedIdx).toBeLessThan(emittedIdx);
    } finally {
      delete process.env.ATLAS_FF_DESIGNER_CRITIQUE;
    }
  });

  it("skips critique+revise when flag off, emits draft as final", async () => {
    const calls: string[] = [];
    const llm = {
      completeWithToolUse: async (_msgs: unknown, opts: { tools?: Array<{ name: string }> }) => {
        const toolName = opts.tools?.[0]?.name ?? "unknown";
        calls.push(toolName);
        return {
          toolName: "emit_proposal",
          input: {
            recommended: {
              id: "draft-only",
              name: "Draft",
              shortDescription: "x",
              technicalDescription: "y",
              citedReferences: [],
              tokens: {
                palette: { primary: "#000000", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
                typeScale: { sansFamily: "Inter", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
                density: "spacious",
                componentSet: "shadcn",
                imageryStrategy: "photo",
                copyVoice: "premium"
              }
            },
            alternates: [
              {
                id: "alt-a",
                name: "Alt A",
                shortDescription: "a",
                technicalDescription: "b",
                citedReferences: [],
                tokens: {
                  palette: { primary: "#111111", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
                  typeScale: { sansFamily: "Inter", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
                  density: "spacious",
                  componentSet: "shadcn",
                  imageryStrategy: "photo",
                  copyVoice: "premium"
                }
              },
              {
                id: "alt-b",
                name: "Alt B",
                shortDescription: "a",
                technicalDescription: "b",
                citedReferences: [],
                tokens: {
                  palette: { primary: "#222222", accent: "#fbbf24", surface: "#fef3c7", text: "#1f2937", muted: "#6b7280" },
                  typeScale: { sansFamily: "Inter", monoFamily: "JetBrains Mono", baseSizePx: 16, scale: "minor-third" },
                  density: "spacious",
                  componentSet: "shadcn",
                  imageryStrategy: "photo",
                  copyVoice: "premium"
                }
              }
            ],
            reasoning: "draft only"
          }
        };
      }
    };
    delete process.env.ATLAS_FF_DESIGNER_CRITIQUE;
    const role = new DesignerRole({ llm: llm as never });
    const out = await role.run({
      ritualId: "r1",
      intent: "build a restaurant page",
      userTurn: "build a restaurant page",
      graphSlice: { bytes: "{}", hash: "h" },
      priorArtifact: {
        brief: {
          category: "restaurant-landing",
          audienceCues: ["general"],
          references: [],
          patternsThatWin: [],
          patternsThatLose: []
        },
        designIntent: { category: "restaurant-landing", audienceCues: ["general"] },
        architectArtifact: {}
      }
    });
    expect(calls).toEqual(["emit_proposal"]);
    const finalProposalEvent = out.events.find((e) => e.eventType === "designer.proposal.emitted");
    expect((finalProposalEvent?.payload as { proposal?: { recommended?: { id?: string } } })?.proposal?.recommended?.id).toBe("draft-only");

    const types = out.events.map((e) => e.eventType);
    expect(types).not.toContain("designer.critique.started");
    expect(types).not.toContain("designer.critique.completed");
    expect(types).not.toContain("designer.revise.started");
    expect(types).not.toContain("designer.revise.completed");
  });
});
