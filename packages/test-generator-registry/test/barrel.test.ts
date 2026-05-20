import { describe, it, expect } from "vitest";
import * as pkg from "../src/index.js";

describe("@atlas/test-generator-registry barrel", () => {
  it("exports the public surface", () => {
    expect(typeof pkg.TestGeneratorRegistry).toBe("function");
    expect(typeof pkg.HumanBaselineStore).toBe("function");
    expect(typeof pkg.DriftDetector).toBe("function");
    expect(typeof pkg.invokeGenerator).toBe("function");
    expect(typeof pkg.isProtectedTarget).toBe("function");
    expect(typeof pkg.protectedKindOf).toBe("function");
    expect(typeof pkg.hashActivationBody).toBe("function");
    expect(pkg.BaselineFileSchema).toBeDefined();
    expect(pkg.BaselineAssertionSchema).toBeDefined();
    expect(pkg.CalibrationFileSchema).toBeDefined();
    expect(pkg.CalibrationEntrySchema).toBeDefined();
    expect(pkg.NoGeneratorForKindError).toBeDefined();
    expect(pkg.BaselineMissingError).toBeDefined();
    expect(pkg.BaselineFileParseError).toBeDefined();
    expect(pkg.DriftExceededError).toBeDefined();
  });
});
