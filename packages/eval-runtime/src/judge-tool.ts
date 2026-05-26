// src/judge-tool.ts
export const JUDGE_TOOL_NAME = "verdict";

export const JUDGE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    passed: { type: "boolean", description: "true iff ALL dimensions scored at or above their pass thresholds" },
    score: { type: "number", minimum: 0, maximum: 10, description: "Overall quality score 0-10" },
    dimensions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          score: { type: "number", minimum: 0, maximum: 10 },
          rationale: { type: "string" }
        },
        required: ["name", "score", "rationale"]
      }
    },
    fixableBy: {
      type: "string",
      enum: ["retry", "escalate"],
      description: "'retry' = the role can likely fix this with feedback; 'escalate' = fundamental issue, no retry"
    },
    feedback: {
      type: "string",
      description: "Specific, actionable feedback the role's next attempt should address"
    }
  },
  required: ["passed", "score", "dimensions", "fixableBy", "feedback"]
} as const;
