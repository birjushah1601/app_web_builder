import { describe, it, expect } from "vitest";
import { ResearcherFailedError, CatalogParseError, WebFetchError } from "../src/errors.js";

describe("ResearcherFailedError", () => {
  it("captures cause + category", () => {
    const cause = new Error("LLM 503");
    const err = new ResearcherFailedError("brief assembly failed", { cause, category: "restaurant-landing" });
    expect(err.message).toMatch(/brief assembly failed/);
    expect(err.cause).toBe(cause);
    expect(err.category).toBe("restaurant-landing");
    expect(err.name).toBe("ResearcherFailedError");
  });
});

describe("CatalogParseError", () => {
  it("captures filename", () => {
    const err = new CatalogParseError("invalid yaml", { file: "restaurant-landing.yaml" });
    expect(err.file).toBe("restaurant-landing.yaml");
    expect(err.name).toBe("CatalogParseError");
  });
});

describe("WebFetchError", () => {
  it("captures provider + status", () => {
    const err = new WebFetchError("Brave returned 429", { provider: "brave", status: 429 });
    expect(err.provider).toBe("brave");
    expect(err.status).toBe(429);
    expect(err.name).toBe("WebFetchError");
  });
});
