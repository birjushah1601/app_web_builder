import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { createTmpRepo } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER_BIN = resolve(__dirname, "..", "bin", "atlas-merge-driver.js");

describe("integration: spec.graph.json merge without ATLAS_DATABASE_URL (fallback)", () => {
  it("runs the structural fallback merger and unions nodes by id", async () => {
    const repo = await createTmpRepo("atlas-int-graph-fb-");
    mkdirSync(join(repo, ".atlas"), { recursive: true });
    writeFileSync(
      join(repo, ".gitattributes"),
      ".atlas/events.jsonl     merge=atlas-spec-graph\n.atlas/spec.graph.json  merge=atlas-spec-graph\n"
    );
    await execa(
      "git",
      ["config", "merge.atlas-spec-graph.driver", `node "${DRIVER_BIN}" merge %O %A %B %P`],
      { cwd: repo }
    );

    const graphPath = join(repo, ".atlas", "spec.graph.json");
    writeFileSync(
      graphPath,
      JSON.stringify({ schemaVersion: 1, nodes: [], edges: [], metadata: {} })
    );
    await execa("git", ["add", "."], { cwd: repo });
    await execa("git", ["commit", "-m", "seed"], { cwd: repo });

    await execa("git", ["checkout", "-b", "branchA"], { cwd: repo });
    writeFileSync(
      graphPath,
      JSON.stringify({ schemaVersion: 1, nodes: [{ id: "A" }], edges: [], metadata: {} })
    );
    await execa("git", ["commit", "-am", "A"], { cwd: repo });

    await execa("git", ["checkout", "main"], { cwd: repo });
    writeFileSync(
      graphPath,
      JSON.stringify({ schemaVersion: 1, nodes: [{ id: "B" }], edges: [], metadata: {} })
    );
    await execa("git", ["commit", "-am", "B"], { cwd: repo });

    const env = { ...process.env };
    delete env.ATLAS_DATABASE_URL;
    const res = await execa("git", ["merge", "--no-edit", "branchA"], { cwd: repo, env, reject: false });
    expect(res.exitCode).toBe(0);

    const merged = JSON.parse(readFileSync(graphPath, "utf8"));
    expect(merged.nodes.map((n: { id: string }) => n.id).sort()).toEqual(["A", "B"]);
  });
});
