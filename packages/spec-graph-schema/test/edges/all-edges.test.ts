import { describe, expect, it } from "vitest";
import { RendersEdgeSchema } from "../../src/edges/renders.js";
import { FetchesEdgeSchema } from "../../src/edges/fetches.js";
import { ReadsEdgeSchema } from "../../src/edges/reads.js";
import { MutatesEdgeSchema } from "../../src/edges/mutates.js";
import { RequiresEdgeSchema } from "../../src/edges/requires.js";
import { CoversEdgeSchema } from "../../src/edges/covers.js";
import { DependsOnEdgeSchema } from "../../src/edges/depends-on.js";
import { StyledByEdgeSchema } from "../../src/edges/styled-by.js";
import { SubjectToEdgeSchema } from "../../src/edges/subject-to.js";
import { SupersedesEdgeSchema } from "../../src/edges/supersedes.js";
import { PowersEdgeSchema } from "../../src/edges/powers.js";
import { DisplaysEdgeSchema } from "../../src/edges/displays.js";
import { ManagesEdgeSchema } from "../../src/edges/manages.js";
import { EdgeSchema, edgeRegistry, EDGE_TYPES } from "../../src/edges/index.js";

const each = [
  ["renders", RendersEdgeSchema],
  ["fetches", FetchesEdgeSchema],
  ["reads", ReadsEdgeSchema],
  ["mutates", MutatesEdgeSchema]
] as const;

describe("composition + data edges", () => {
  for (const [type, schema] of each) {
    it(`${type}: accepts {type, from, to}`, () => {
      expect(() => schema.parse({ type, from: "page:home", to: "component:Button" })).not.toThrow();
    });
    it(`${type}: rejects unknown type literal`, () => {
      expect(() => schema.parse({ type: "wrong", from: "page:home", to: "component:Button" })).toThrow();
    });
    it(`${type}: rejects malformed NodeId`, () => {
      expect(() => schema.parse({ type, from: "no-colon", to: "component:Button" })).toThrow();
    });
  }
});

describe("protection/coverage/deps edges", () => {
  for (const [type, schema] of [
    ["requires", RequiresEdgeSchema],
    ["covers", CoversEdgeSchema],
    ["dependsOn", DependsOnEdgeSchema]
  ] as const) {
    it(`${type}: accepts valid edge`, () => {
      expect(() => schema.parse({ type, from: "page:home", to: "authboundary:admin" })).not.toThrow();
    });
  }
});

describe("design/compliance/lineage edges", () => {
  for (const [type, schema] of [
    ["styledBy", StyledByEdgeSchema],
    ["subjectTo", SubjectToEdgeSchema],
    ["supersedes", SupersedesEdgeSchema]
  ] as const) {
    it(`${type}: accepts valid edge`, () => {
      expect(() => schema.parse({ type, from: "component:Button", to: "designtoken:color-primary-500" })).not.toThrow();
    });
  }
});

describe("AI/media/state edges", () => {
  for (const [type, schema] of [
    ["powers", PowersEdgeSchema],
    ["displays", DisplaysEdgeSchema],
    ["manages", ManagesEdgeSchema]
  ] as const) {
    it(`${type}: accepts valid edge`, () => {
      expect(() => schema.parse({ type, from: "aifeature:summarize", to: "endpoint:createUser" })).not.toThrow();
    });
  }
});

describe("edge index", () => {
  it("discriminated union accepts a renders edge", () => {
    const parsed = EdgeSchema.parse({ type: "renders", from: "page:home", to: "component:Button" });
    if (parsed.type === "renders") expect(parsed.from).toBe("page:home");
  });
  it("registry contains all 13 types", () => {
    expect(Object.keys(edgeRegistry).sort()).toEqual([...EDGE_TYPES].sort());
  });
});
