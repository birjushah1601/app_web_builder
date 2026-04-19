import { describe, expect, it } from "vitest";
import { RendersEdgeSchema } from "../../src/edges/renders.js";
import { FetchesEdgeSchema } from "../../src/edges/fetches.js";
import { ReadsEdgeSchema } from "../../src/edges/reads.js";
import { MutatesEdgeSchema } from "../../src/edges/mutates.js";

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
