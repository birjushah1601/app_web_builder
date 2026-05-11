import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { loadCatalog, lookupCategory, type CatalogEntry } from "../src/local-catalog.js";

const CATALOG_DIR = path.resolve(__dirname, "..", "catalog");

describe("loadCatalog", () => {
  it("loads all yaml files and returns a map keyed by category", async () => {
    const catalog = await loadCatalog(CATALOG_DIR);
    expect(catalog.size).toBeGreaterThan(0);
    expect(catalog.has("restaurant-landing")).toBe(true);
  });

  it("each entry has the expected shape", async () => {
    const catalog = await loadCatalog(CATALOG_DIR);
    const entry = catalog.get("restaurant-landing")!;
    expect(entry.category).toBe("restaurant-landing");
    expect(entry.references.length).toBeGreaterThan(0);
    expect(entry.references[0].name).toBeTruthy();
    expect(entry.references[0].why).toBeTruthy();
    expect(entry.patternsThatWin.length).toBeGreaterThan(0);
  });
});

describe("lookupCategory", () => {
  let catalog: Map<string, CatalogEntry>;

  beforeAll(async () => {
    catalog = await loadCatalog(CATALOG_DIR);
  });

  it("matches direct category", () => {
    const hit = lookupCategory(catalog, "restaurant-landing");
    expect(hit).toBeDefined();
    expect(hit?.category).toBe("restaurant-landing");
  });

  it("matches case-insensitive", () => {
    const hit = lookupCategory(catalog, "Restaurant-Landing");
    expect(hit).toBeDefined();
  });

  it("matches synonyms", () => {
    const hit = lookupCategory(catalog, "cafe-website");
    expect(hit).toBeDefined();
    expect(hit?.category).toBe("restaurant-landing");
  });

  it("returns undefined when no match", () => {
    expect(lookupCategory(catalog, "battle-mech-configurator")).toBeUndefined();
  });
});
