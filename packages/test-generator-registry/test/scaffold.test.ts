import { describe, it, expect } from "vitest";
import * as pkg from "../src/index.js";

describe("@atlas/test-generator-registry package barrel", () => {
  it("exposes a stable barrel", () => {
    expect(pkg).toBeDefined();
  });
});
