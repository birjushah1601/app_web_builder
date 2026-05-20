import { describe, it, expect } from "vitest";
import { VisualQualityError, ScreenshotFailedError, SkillMissingError } from "../src/errors.js";

describe("VisualQualityError", () => {
  it("captures cause", () => {
    const cause = new Error("LLM 503");
    const err = new VisualQualityError("critique failed", { cause });
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("VisualQualityError");
  });
});

describe("ScreenshotFailedError", () => {
  it("captures viewport + cause", () => {
    const cause = new Error("puppeteer crashed");
    const err = new ScreenshotFailedError("screenshot failed for tablet", { viewport: "tablet", cause });
    expect(err.viewport).toBe("tablet");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("ScreenshotFailedError");
  });
});

describe("SkillMissingError", () => {
  it("captures skill name", () => {
    const err = new SkillMissingError("critique-design-tokens");
    expect(err.skillName).toBe("critique-design-tokens");
    expect(err.message).toContain("critique-design-tokens");
    expect(err.name).toBe("SkillMissingError");
  });
});
