import { describe, it, expect } from "vitest";
import { VisualQualityError, ScreenshotFailedError, SkillMissingError, InfrastructureUnavailableError } from "../src/errors.js";

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

describe("InfrastructureUnavailableError", () => {
  it("captures signature + viewport + cause", () => {
    const cause = new Error("Cannot find module 'puppeteer-core'");
    const err = new InfrastructureUnavailableError("puppeteer-core not installed in sandbox", {
      signature: "puppeteer-core-missing",
      viewport: "desktop",
      cause
    });
    expect(err.signature).toBe("puppeteer-core-missing");
    expect(err.viewport).toBe("desktop");
    expect(err.cause).toBe(cause);
    expect(err.name).toBe("InfrastructureUnavailableError");
  });

  it("is distinguishable from ScreenshotFailedError via instanceof", () => {
    const infra = new InfrastructureUnavailableError("x", { signature: "puppeteer-core-missing" });
    const real = new ScreenshotFailedError("x");
    expect(infra instanceof InfrastructureUnavailableError).toBe(true);
    expect(infra instanceof ScreenshotFailedError).toBe(false);
    expect(real instanceof InfrastructureUnavailableError).toBe(false);
  });
});
