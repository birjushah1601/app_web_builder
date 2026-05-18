import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");

test("validate-frontmatter exits 0 over the real skills/ tree", () => {
  const result = spawnSync("node", ["scripts/validate-frontmatter.mjs"], {
    cwd: pkgRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `validator failed:\n${result.stdout}\n${result.stderr}`);
  // Count floats as the library grows (C.3 added test-generators, B-7 added
  // compliance skills, B-8 added browser-verification, B-9 added migration).
  // Lock only the shape + a sane minimum.
  assert.match(result.stdout, /validated \d+ skills/);
  const match = result.stdout.match(/validated (\d+) skills/);
  const count = match ? Number(match[1]) : 0;
  assert.ok(count >= 40, `expected at least 40 skills, got ${count}`);
});

test("validate-frontmatter exits non-zero when a skill has no frontmatter", async () => {
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const tmp = mkdtempSync(join(tmpdir(), "skill-lib-validator-"));
  mkdirSync(join(tmp, "skills", "test"), { recursive: true });
  writeFileSync(join(tmp, "skills", "test", "bad.md"), "# no frontmatter here\n", "utf8");
  try {
    const result = spawnSync("node", ["scripts/validate-frontmatter.mjs"], {
      cwd: pkgRoot,
      env: { ...process.env, SKILL_LIBRARY_ROOT: tmp },
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /bad\.md/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("validate-frontmatter rejects test-generators that omit activate_on", async () => {
  const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const tmp = mkdtempSync(join(tmpdir(), "skill-lib-validator-"));
  mkdirSync(join(tmp, "skills", "test-generators"), { recursive: true });
  writeFileSync(
    join(tmp, "skills", "test-generators", "gen-test-missing-activate.md"),
    `---
name: gen-test-missing-activate
description: bad — test generators must carry activate_on
---

# body
`,
    "utf8"
  );
  try {
    const result = spawnSync("node", ["scripts/validate-frontmatter.mjs"], {
      cwd: pkgRoot,
      env: { ...process.env, SKILL_LIBRARY_ROOT: tmp },
      encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /activate_on/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
