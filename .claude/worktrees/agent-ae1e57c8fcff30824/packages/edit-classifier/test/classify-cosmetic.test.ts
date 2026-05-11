import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { diffGraphs } from "../src/diff.js";
import { classifyEdit } from "../src/classify.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures", "edits", "cosmetic");

describe("cosmetic edit fixtures", () => {
  for (const dir of readdirSync(root)) {
    const fullDir = join(root, dir);
    if (!statSync(fullDir).isDirectory()) continue;
    it(`${dir} → cosmetic`, () => {
      const before = JSON.parse(readFileSync(join(fullDir, "before.json"), "utf8"));
      const after = JSON.parse(readFileSync(join(fullDir, "after.json"), "utf8"));
      const result = classifyEdit(diffGraphs(before, after));
      expect(result.class).toBe("cosmetic");
    });
  }
});
