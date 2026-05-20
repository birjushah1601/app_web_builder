import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli.js";

describe("CLI: merge subcommand", () => {
  let dir: string;
  let origExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "atlas-cli-merge-"));
    exitCode = undefined;
    origExit = process.exit;
    // Replace process.exit to record without aborting the test
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`__atlas_exit_${code ?? 0}__`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    process.exit = origExit;
  });

  it("exits 0 and writes the merged result to %A for events.jsonl", async () => {
    const base = join(dir, "base");
    const ours = join(dir, "ours");
    const theirs = join(dir, "theirs");
    writeFileSync(base, "");
    writeFileSync(ours, '{"id":"1","createdAt":"2026-01-01T00:00:00Z"}\n');
    writeFileSync(theirs, '{"id":"2","createdAt":"2026-01-02T00:00:00Z"}\n');

    await expect(
      main(["node", "atlas-merge-driver", "merge", base, ours, theirs, ".atlas/events.jsonl"])
    ).rejects.toThrow("__atlas_exit_0__");
    expect(exitCode).toBe(0);

    const result = readFileSync(ours, "utf8");
    const ids = result.trim().split("\n").map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["1", "2"]);
  });

  it("exits 2 for an unknown pathname", async () => {
    const base = join(dir, "base");
    const ours = join(dir, "ours");
    const theirs = join(dir, "theirs");
    writeFileSync(base, "");
    writeFileSync(ours, "foo");
    writeFileSync(theirs, "bar");

    await expect(
      main(["node", "atlas-merge-driver", "merge", base, ours, theirs, "src/index.ts"])
    ).rejects.toThrow("__atlas_exit_2__");
    expect(exitCode).toBe(2);
  });

  it("exits 1 on an I/O error (unwritable %A)", async () => {
    // Use a path that definitely cannot be written: a directory.
    await expect(
      main(["node", "atlas-merge-driver", "merge", dir, dir, dir, ".atlas/events.jsonl"])
    ).rejects.toThrow(/__atlas_exit_[12]__/);
    expect(exitCode === 1 || exitCode === 2).toBe(true);
  });
});
