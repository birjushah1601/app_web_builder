import { describe, it, expect } from "vitest";
import { parseVitestJson } from "../src/parse-vitest-json.js";

const VITEST_JSON = JSON.stringify({
  numTotalTests: 3,
  numPassedTests: 2,
  numFailedTests: 1,
  numPendingTests: 0,
  testResults: [
    {
      name: "__tests__/Home.test.tsx",
      status: "failed",
      assertionResults: [
        { status: "passed", title: "renders heading", duration: 12 },
        { status: "passed", title: "fires onClick", duration: 8 },
        { status: "failed", title: "shows error banner", duration: 5, failureMessages: ["Expected 'oops' got 'ok'"] }
      ]
    }
  ]
});

describe("parseVitestJson", () => {
  it("normalizes the per-file pass/fail/skip counts", () => {
    const r = parseVitestJson(VITEST_JSON);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ file: "__tests__/Home.test.tsx", passed: 2, failed: 1, skipped: 0 });
  });
  it("extracts the first failureMessages entry as lastError", () => {
    const r = parseVitestJson(VITEST_JSON);
    expect(r[0]?.lastError).toContain("Expected 'oops'");
  });
  it("sums durationMs across assertions", () => {
    const r = parseVitestJson(VITEST_JSON);
    expect(r[0]?.durationMs).toBe(25);
  });
  it("returns [] on malformed input", () => {
    expect(parseVitestJson("not json")).toEqual([]);
    expect(parseVitestJson('{"wrong":"shape"}')).toEqual([]);
  });
  it("handles a fully-passing file (no failureMessages)", () => {
    const ok = JSON.stringify({
      testResults: [
        { name: "__tests__/X.test.tsx", status: "passed", assertionResults: [{ status: "passed", title: "x", duration: 4 }] }
      ]
    });
    const r = parseVitestJson(ok);
    expect(r[0]).toMatchObject({ file: "__tests__/X.test.tsx", passed: 1, failed: 0 });
    expect(r[0]?.lastError).toBeUndefined();
  });
});
