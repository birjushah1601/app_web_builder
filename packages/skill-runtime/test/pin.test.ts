import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePinFile, loadPinFile, checkPinVersions, SkillVersionMismatchError, type SkillPin } from "../src/pin.js";

const FIXTURE_PIN = path.resolve(import.meta.dirname, "fixtures/pin.json");

describe("parsePinFile", () => {
  it("accepts a valid pin array", () => {
    const pins: SkillPin[] = parsePinFile([
      { skill: "brainstorm", version: "1.0.0", provenance: "bundled" },
      { skill: "tdd-feature", version: "1.2.3", provenance: "local" }
    ]);
    expect(pins).toHaveLength(2);
    expect(pins[0].skill).toBe("brainstorm");
  });

  it("rejects a pin with an invalid semver version", () => {
    expect(() =>
      parsePinFile([{ skill: "brainstorm", version: "not-semver", provenance: "bundled" }])
    ).toThrow();
  });

  it("rejects a pin with a missing skill field", () => {
    expect(() =>
      parsePinFile([{ version: "1.0.0", provenance: "bundled" }])
    ).toThrow();
  });

  it("rejects non-array input", () => {
    expect(() => parsePinFile({ skill: "brainstorm", version: "1.0.0", provenance: "bundled" })).toThrow();
  });
});

describe("loadPinFile", () => {
  it("loads and parses the fixture pin.json", () => {
    const pins = loadPinFile(FIXTURE_PIN);
    expect(pins.length).toBeGreaterThanOrEqual(1);
    expect(pins[0].skill).toBeDefined();
  });

  it("returns empty array for a non-existent file", () => {
    const pins = loadPinFile(path.join(import.meta.dirname, "fixtures/__no_pin.json"));
    expect(pins).toEqual([]);
  });
});

describe("checkPinVersions", () => {
  const pins: SkillPin[] = [
    { skill: "brainstorm", version: "1.0.0", provenance: "bundled" }
  ];

  it("passes silently when the loaded skill version matches the pin", () => {
    expect(() =>
      checkPinVersions(pins, [
        {
          frontmatter: { name: "brainstorm", description: "x", activate_on: ["x"], version: "1.0.0" } as never,
          body: "",
          sourcePath: "/virtual/brainstorm.md"
        }
      ])
    ).not.toThrow();
  });

  it("throws SkillVersionMismatchError when a pinned skill has no version field", () => {
    expect(() =>
      checkPinVersions(pins, [
        {
          frontmatter: { name: "brainstorm", description: "x", activate_on: ["x"] } as never,
          body: "",
          sourcePath: "/virtual/brainstorm.md"
        }
      ])
    ).toThrow(SkillVersionMismatchError);
  });

  it("passes silently when a pinned skill is not currently loaded (it may be optional)", () => {
    expect(() => checkPinVersions(pins, [])).not.toThrow();
  });
});
