import { describe, it, expect } from "vitest";
import { ArchitectError, TriageFailedError, DeepPlanFailedError, SkillMissingError } from "../src/errors.js";

describe("Architect errors", () => {
  it("ArchitectError is the base", () => {
    const e = new ArchitectError("boom");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ArchitectError");
  });

  it("SkillMissingError names the skill", () => {
    const e = new SkillMissingError("brainstorm");
    expect(e.skillName).toBe("brainstorm");
    expect(e.message).toMatch(/brainstorm/);
  });

  it("TriageFailedError captures cause", () => {
    const cause = new Error("network");
    const e = new TriageFailedError("pass 1 failed", { cause });
    expect(e.cause).toBe(cause);
  });

  it("DeepPlanFailedError captures cause + scope", () => {
    const e = new DeepPlanFailedError("pass 2 failed", { scope: "new-feature" });
    expect(e.scope).toBe("new-feature");
  });
});
