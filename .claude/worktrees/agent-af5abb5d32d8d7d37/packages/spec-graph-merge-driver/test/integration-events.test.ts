import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { createTmpRepo } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER_BIN = resolve(__dirname, "..", "bin", "atlas-merge-driver.js");

async function registerLocalDriver(repo: string): Promise<void> {
  mkdirSync(join(repo, ".atlas"), { recursive: true });
  writeFileSync(
    join(repo, ".gitattributes"),
    ".atlas/events.jsonl     merge=atlas-spec-graph\n" +
      ".atlas/spec.graph.json  merge=atlas-spec-graph\n"
  );
  await execa("git", ["config", "merge.atlas-spec-graph.name", "Atlas Spec Graph merge driver"], { cwd: repo });
  await execa(
    "git",
    ["config", "merge.atlas-spec-graph.driver", `node "${DRIVER_BIN}" merge %O %A %B %P`],
    { cwd: repo }
  );
  await execa("git", ["config", "merge.atlas-spec-graph.recursive", "binary"], { cwd: repo });
}

describe("integration: real git merge of .atlas/events.jsonl", () => {
  it("merges divergent branches without conflict markers or data loss", async () => {
    const repo = await createTmpRepo("atlas-int-events-");
    await registerLocalDriver(repo);

    const eventsPath = join(repo, ".atlas", "events.jsonl");
    writeFileSync(eventsPath, '{"id":"1","createdAt":"2026-01-01T00:00:00Z","type":"seed"}\n');
    await execa("git", ["add", "."], { cwd: repo });
    await execa("git", ["commit", "-m", "seed"], { cwd: repo });

    await execa("git", ["checkout", "-b", "branchA"], { cwd: repo });
    writeFileSync(
      eventsPath,
      readFileSync(eventsPath, "utf8") +
        '{"id":"2","createdAt":"2026-01-02T00:00:00Z","type":"A"}\n'
    );
    await execa("git", ["commit", "-am", "branchA event"], { cwd: repo });

    await execa("git", ["checkout", "main"], { cwd: repo });
    writeFileSync(
      eventsPath,
      readFileSync(eventsPath, "utf8") +
        '{"id":"3","createdAt":"2026-01-03T00:00:00Z","type":"main"}\n'
    );
    await execa("git", ["commit", "-am", "main event"], { cwd: repo });

    const result = await execa("git", ["merge", "--no-edit", "branchA"], { cwd: repo, reject: false });
    expect(result.exitCode).toBe(0);

    const merged = readFileSync(eventsPath, "utf8");
    expect(merged).not.toMatch(/<<<<<<</);
    const ids = merged.trim().split("\n").map((l) => JSON.parse(l).id);
    expect(ids).toEqual(["1", "2", "3"]);
  });
});
