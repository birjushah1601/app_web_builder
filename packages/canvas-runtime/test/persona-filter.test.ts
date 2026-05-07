import { describe, it, expect } from "vitest";
import { personaFilter } from "../src/persona-filter.js";
import type { CanvasManifest } from "../src/types.js";

const FULL_MANIFEST: CanvasManifest = {
  artifactKind: "backend-rest-api",
  modes: [
    { id: "schema", renderer: "schema", audience: ["diego", "priya"], default: true },
    { id: "preview", renderer: "preview", audience: ["ama", "diego", "priya"] },
    { id: "endpoints", renderer: "endpoints", audience: ["priya"] }
  ]
};

describe("personaFilter", () => {
  it("ama sees only modes that include ama in audience", () => {
    const filtered = personaFilter(FULL_MANIFEST, "ama");
    expect(filtered.modes.map((m) => m.id)).toEqual(["preview"]);
  });

  it("diego sees ama + diego modes", () => {
    const filtered = personaFilter(FULL_MANIFEST, "diego");
    expect(filtered.modes.map((m) => m.id).sort()).toEqual(["preview", "schema"]);
  });

  it("priya sees all modes", () => {
    const filtered = personaFilter(FULL_MANIFEST, "priya");
    expect(filtered.modes.map((m) => m.id).sort()).toEqual(["endpoints", "preview", "schema"]);
  });

  it("null persona defaults to ama", () => {
    const filtered = personaFilter(FULL_MANIFEST, null);
    expect(filtered.modes.map((m) => m.id)).toEqual(["preview"]);
  });

  it("preserves artifactKind + ordering", () => {
    const filtered = personaFilter(FULL_MANIFEST, "priya");
    expect(filtered.artifactKind).toBe("backend-rest-api");
    // ordering preserved relative to input
    expect(filtered.modes.map((m) => m.id)).toEqual(["schema", "preview", "endpoints"]);
  });

  it("returns manifest with empty modes when no mode matches", () => {
    const NO_MATCH: CanvasManifest = {
      artifactKind: "frontend-app",
      modes: [{ id: "x", renderer: "x", audience: ["priya"] }]
    };
    const filtered = personaFilter(NO_MATCH, "ama");
    expect(filtered.modes).toEqual([]);
  });
});
