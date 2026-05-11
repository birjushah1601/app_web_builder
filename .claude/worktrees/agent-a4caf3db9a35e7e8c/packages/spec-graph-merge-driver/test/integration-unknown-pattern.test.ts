import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER_BIN = resolve(__dirname, "..", "bin", "atlas-merge-driver.js");

describe("integration: unknown pattern exits 2 with stderr error", () => {
  it("exits with code 2 and writes a JSON error line to stderr for unregistered paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlas-unknown-"));
    const base = join(dir, "base");
    const ours = join(dir, "ours");
    const theirs = join(dir, "theirs");
    writeFileSync(base, "");
    writeFileSync(ours, "foo");
    writeFileSync(theirs, "bar");

    const res = await execa(
      "node",
      [DRIVER_BIN, "merge", base, ours, theirs, "src/unknown.ts"],
      { reject: false }
    );
    expect(res.exitCode).toBe(2);
    expect(res.stderr).toMatch(/unknown pattern/i);
    const lines = res.stderr.trim().split("\n");
    const lastEntry = JSON.parse(lines[lines.length - 1]!);
    expect(lastEntry.level).toBe("error");
    expect(lastEntry.pathname).toBe("src/unknown.ts");
  });
});
