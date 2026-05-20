import { describe, it, expect } from "vitest";
import { DeveloperOutputSchema, ReviewerVoteSchema, type DeveloperOutput } from "../src/types.js";

describe("D.3 types", () => {
  it("DeveloperOutputSchema parses a valid diff payload", () => {
    const out: DeveloperOutput = {
      diff: "@@ -1 +1 @@\n-foo\n+bar\n",
      summary: "Renamed foo to bar in one file",
      testsAdded: ["test/rename.test.ts"],
      filesModified: ["src/foo.ts"]
    };
    expect(DeveloperOutputSchema.parse(out)).toEqual(out);
  });

  it("rejects DeveloperOutput with empty diff", () => {
    expect(() => DeveloperOutputSchema.parse({ diff: "", summary: "x", testsAdded: [], filesModified: ["a.ts"] })).toThrow();
  });

  it("ReviewerVoteSchema parses anthropic + google + reasoning", () => {
    expect(ReviewerVoteSchema.parse({ winner: "anthropic", reasoning: "tighter test coverage" })).toMatchObject({ winner: "anthropic" });
    expect(ReviewerVoteSchema.parse({ winner: "google", reasoning: "smaller diff, same test" })).toMatchObject({ winner: "google" });
  });

  it("rejects ReviewerVote with empty reasoning", () => {
    expect(() => ReviewerVoteSchema.parse({ winner: "anthropic", reasoning: "" })).toThrow();
  });
});
