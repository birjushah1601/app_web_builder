import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { HumanBaselineStore } from "../src/baseline-store.js";
import { BaselineFileParseError, BaselineMissingError } from "../src/errors.js";

const fixturesDir = resolve(__dirname, "fixtures/baselines");

describe("HumanBaselineStore", () => {
  it("loads all .yaml files in the directory on construction", async () => {
    const store = await HumanBaselineStore.fromDir(fixturesDir);
    expect(store.kinds().sort()).toEqual(["authboundary", "compliance", "pii-model"]);
  });

  it("returns assertions for a given kind", async () => {
    const store = await HumanBaselineStore.fromDir(fixturesDir);
    const assertions = store.getAssertions("authboundary");
    expect(assertions.length).toBe(2);
    expect(assertions[0]?.id).toBe("unauthed-returns-401");
  });

  it("throws BaselineMissingError when kind has no file", async () => {
    const store = await HumanBaselineStore.fromDir(fixturesDir);
    expect(() => store.getAssertions("nonexistent" as never)).toThrow(BaselineMissingError);
  });

  it("throws BaselineFileParseError on invalid YAML", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "baseline-invalid-"));
    await writeFile(join(dir, "bad.yaml"), "kind: authboundary\nversion: 1\nassertions: []\n");
    await expect(HumanBaselineStore.fromDir(dir)).rejects.toThrow(BaselineFileParseError);
  });
});
