import { describe, it, expect } from "vitest";
import { PersonaTierSchema, type PersonaTier, type PersonaPreferences, isAtLeast } from "../src/personas.js";

describe("PersonaTier", () => {
  it("accepts the three canonical tiers", () => {
    for (const t of ["ama", "diego", "priya"] as const) {
      expect(PersonaTierSchema.parse(t)).toBe(t);
    }
  });

  it("rejects unknown tiers", () => {
    expect(() => PersonaTierSchema.parse("admin")).toThrow();
  });

  it("isAtLeast reflects the linear ordering ama < diego < priya", () => {
    expect(isAtLeast("ama", "ama")).toBe(true);
    expect(isAtLeast("diego", "ama")).toBe(true);
    expect(isAtLeast("priya", "diego")).toBe(true);
    expect(isAtLeast("ama", "diego")).toBe(false);
    expect(isAtLeast("ama", "priya")).toBe(false);
    expect(isAtLeast("diego", "priya")).toBe(false);
  });

  it("PersonaPreferences interface accepts an in-memory implementation", async () => {
    const stored = new Map<string, PersonaTier>([["u-1:p-1", "diego"]]);
    const prefs: PersonaPreferences = {
      async getPersona(userId, projectId) {
        return stored.get(`${userId}:${projectId}`) ?? "ama";
      }
    };
    expect(await prefs.getPersona("u-1", "p-1")).toBe("diego");
    expect(await prefs.getPersona("u-1", "p-other")).toBe("ama");
  });
});
