import { describe, it, expect } from "vitest";
import { BaselineFileSchema } from "../src/baseline-schema.js";

describe("BaselineFileSchema", () => {
  const valid = {
    kind: "authboundary",
    version: 1,
    assertions: [
      {
        id: "unauthed-401",
        description: "Unauthed access returns 401",
        rationale: "Hard security floor — LLM cannot reword",
        checklistItem: "GET /protected without session → 401",
        mustEmitTest: true,
        owner: "security-team"
      }
    ]
  };

  it("accepts a valid baseline file", () => {
    const res = BaselineFileSchema.safeParse(valid);
    expect(res.success).toBe(true);
  });

  it("rejects empty assertions array", () => {
    const res = BaselineFileSchema.safeParse({ ...valid, assertions: [] });
    expect(res.success).toBe(false);
  });

  it("rejects unknown kind", () => {
    const res = BaselineFileSchema.safeParse({ ...valid, kind: "page" });
    expect(res.success).toBe(false);
  });

  it("rejects missing rationale (protects LLM-override rule)", () => {
    const first = valid.assertions[0]!;
    const { rationale: _r, ...rest } = first;
    const bad = { ...valid, assertions: [rest] };
    expect(BaselineFileSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects extra fields (strict)", () => {
    const bad = { ...valid, extraField: "x" };
    expect(BaselineFileSchema.safeParse(bad).success).toBe(false);
  });
});
