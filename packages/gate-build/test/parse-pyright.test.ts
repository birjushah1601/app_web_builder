import { describe, it, expect } from "vitest";
import { parsePyrightJson } from "../src/parse";

describe("parsePyrightJson", () => {
  it("returns empty array on no diagnostics", () => {
    const json = JSON.stringify({ generalDiagnostics: [] });
    expect(parsePyrightJson(json)).toEqual([]);
  });

  it("parses a single error and converts 0-based positions to 1-based", () => {
    const json = JSON.stringify({
      generalDiagnostics: [
        {
          file: "/code/app/main.py",
          severity: "error",
          message: "Expected expression",
          range: { start: { line: 287, character: 98 } }
        }
      ]
    });
    expect(parsePyrightJson(json)).toEqual([
      { file: "/code/app/main.py", line: 288, col: 99, severity: "error", message: "Expected expression" }
    ]);
  });

  it("treats unknown severities as 'error' to fail-safe", () => {
    const json = JSON.stringify({
      generalDiagnostics: [
        { file: "f.py", severity: "fatal", message: "x", range: { start: { line: 0, character: 0 } } }
      ]
    });
    expect(parsePyrightJson(json)[0].severity).toBe("error");
  });

  it("maps 'warning' through unchanged", () => {
    const json = JSON.stringify({
      generalDiagnostics: [
        { file: "f.py", severity: "warning", message: "x", range: { start: { line: 0, character: 0 } } }
      ]
    });
    expect(parsePyrightJson(json)[0].severity).toBe("warning");
  });

  it("returns [] on malformed JSON (caller decides)", () => {
    expect(parsePyrightJson("not json")).toEqual([]);
    expect(parsePyrightJson('{"unrelated":true}')).toEqual([]);
  });
});
