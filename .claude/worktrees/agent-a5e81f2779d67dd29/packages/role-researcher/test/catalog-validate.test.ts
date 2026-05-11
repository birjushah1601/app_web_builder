import { describe, it, expect } from "vitest";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { loadCatalog } from "../src/local-catalog.js";

const CATALOG_DIR = path.resolve(__dirname, "..", "catalog");

describe("catalog validation", () => {
  it("loads all yaml files without error", async () => {
    await expect(loadCatalog(CATALOG_DIR)).resolves.toBeDefined();
  });

  it("contains the v1 target of 30 categories", async () => {
    const files = (await readdir(CATALOG_DIR)).filter((f) => f.endsWith(".yaml"));
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  it("every entry has at least 1 reference", async () => {
    const catalog = await loadCatalog(CATALOG_DIR);
    for (const entry of catalog.values()) {
      expect(entry.references.length).toBeGreaterThan(0);
    }
  });

  it("every entry's category matches its filename (kebab-case convention)", async () => {
    const files = (await readdir(CATALOG_DIR)).filter((f) => f.endsWith(".yaml"));
    const catalog = await loadCatalog(CATALOG_DIR);
    for (const file of files) {
      const expected = file.replace(/\.yaml$/, "");
      const found = Array.from(catalog.values()).some((e) => e.category === expected);
      expect(found, `file ${file} should declare category: ${expected}`).toBe(true);
    }
  });
});
