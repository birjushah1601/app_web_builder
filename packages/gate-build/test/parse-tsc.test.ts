import { describe, it, expect } from "vitest";
import { parseTscOutput } from "../src/parse";

describe("parseTscOutput", () => {
  it("returns empty array on clean output", () => {
    expect(parseTscOutput("")).toEqual([]);
    expect(parseTscOutput("Found 0 errors.\n")).toEqual([]);
  });

  it("parses a single tsc error", () => {
    const out = `src/app/page.tsx(288,99): error TS1005: Expected '</', got 'm'.\n`;
    expect(parseTscOutput(out)).toEqual([
      {
        file: "src/app/page.tsx",
        line: 288,
        col: 99,
        severity: "error",
        message: "TS1005: Expected '</', got 'm'."
      }
    ]);
  });

  it("parses multiple errors and ignores summary lines", () => {
    const out = [
      `src/app/page.tsx(288,99): error TS1005: Expected '</', got 'm'.`,
      `src/lib/foo.ts(12,5): error TS2304: Cannot find name 'bar'.`,
      `Found 2 errors in 2 files.`,
      ``
    ].join("\n");
    const parsed = parseTscOutput(out);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].file).toBe("src/app/page.tsx");
    expect(parsed[1].file).toBe("src/lib/foo.ts");
    expect(parsed[1].line).toBe(12);
  });

  it("preserves severity for warnings", () => {
    const out = `src/x.ts(1,1): warning TS9999: future warning.\n`;
    expect(parseTscOutput(out)[0].severity).toBe("warning");
  });

  it("returns [] on completely unparseable input (caller decides what to do)", () => {
    expect(parseTscOutput("some random text\nwith no tsc errors")).toEqual([]);
  });
});
