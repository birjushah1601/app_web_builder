// test/judge-tool.test.ts
import { describe, it, expect } from "vitest";
import { JUDGE_TOOL_SCHEMA, JUDGE_TOOL_NAME } from "../src/judge-tool.js";

describe("judge tool schema", () => {
  it("has the canonical tool name", () => {
    expect(JUDGE_TOOL_NAME).toBe("verdict");
  });
  it("requires passed/score/dimensions/fixableBy/feedback", () => {
    const schema = JUDGE_TOOL_SCHEMA as { required?: string[] };
    expect(schema.required).toEqual(
      expect.arrayContaining(["passed", "score", "dimensions", "fixableBy", "feedback"])
    );
  });
  it("fixableBy is constrained to retry|escalate", () => {
    const schema = JUDGE_TOOL_SCHEMA as { properties: { fixableBy: { enum: string[] } } };
    expect(schema.properties.fixableBy.enum).toEqual(["retry", "escalate"]);
  });
});
