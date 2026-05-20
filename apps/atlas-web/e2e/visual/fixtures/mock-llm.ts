// Minimal deterministic LLM stub for the generated-restaurant-landing
// visual spec. Returns canned responses keyed by tool name so the spec is
// hermetic (no live API calls during snapshot generation).

export const mockLlm = {
  async completeWithToolUse(
    _messages: unknown[],
    opts: { tools: Array<{ name: string }> }
  ) {
    const toolName = opts.tools[0]?.name ?? "unknown";
    if (toolName === "emit_architect_output") {
      return {
        toolName,
        input: {
          scope: "new-app",
          designIntent: {
            category: "restaurant-landing",
            audienceCues: ["fine-dining"]
          }
        }
      };
    }
    if (toolName === "emit_brief") {
      return {
        toolName,
        input: {
          category: "restaurant-landing",
          audienceCues: ["fine-dining"],
          references: [],
          patternsThatWin: [],
          patternsThatLose: []
        }
      };
    }
    if (toolName === "emit_design_proposal") {
      return {
        toolName,
        input: {
          recommended: {
            id: "editorial-dark",
            name: "Editorial Dark",
            shortDescription: "Premium feel.",
            technicalDescription: "Serif + gold accent.",
            citedReferences: [],
            tokens: {}
          },
          alternates: [],
          reasoning: "Premium signal in prompt."
        }
      };
    }
    return { toolName, input: {} };
  }
};
