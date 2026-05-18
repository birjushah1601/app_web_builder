import { describe, it, expect } from "vitest";
import { BUILD_COMMANDS, type BuildCommand, type KnownTemplate } from "../src/commands";

const EXPECTED_TEMPLATES: ReadonlyArray<KnownTemplate> = [
  "atlas-next-ts",
  "atlas-next-ts-v2",
  "atlas-fastapi",
  "atlas-dlt-python",
  "atlas-graphql-yoga",
  "atlas-bun-cli",
  "atlas-expo-rn",
  "atlas-hono-bun"
];

describe("BUILD_COMMANDS", () => {
  it("has an entry for every known template", () => {
    const keys = Object.keys(BUILD_COMMANDS).sort();
    expect(keys).toEqual([...EXPECTED_TEMPLATES].sort());
  });

  it("every entry has a non-empty exec, a known parser, and a positive timeout", () => {
    for (const [template, cmd] of Object.entries(BUILD_COMMANDS) as Array<[string, BuildCommand]>) {
      expect(cmd.exec, `${template}.exec`).not.toBe("");
      expect(["tsc", "pyright"]).toContain(cmd.parser);
      expect(cmd.timeoutMs).toBeGreaterThan(0);
    }
  });

  it("uses pyright for Python templates and tsc for TS templates", () => {
    expect(BUILD_COMMANDS["atlas-fastapi"].parser).toBe("pyright");
    expect(BUILD_COMMANDS["atlas-dlt-python"].parser).toBe("pyright");
    expect(BUILD_COMMANDS["atlas-next-ts-v2"].parser).toBe("tsc");
    expect(BUILD_COMMANDS["atlas-bun-cli"].parser).toBe("tsc");
  });
});
