import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installDriver } from "../src/install/install.js";
import { createTmpRepo, gitConfigGet, readFileOrEmpty } from "./helpers.js";

describe("installDriver", () => {
  it("creates .gitattributes with both patterns when none exists", async () => {
    const repo = await createTmpRepo();
    await installDriver(repo);
    const content = readFileSync(join(repo, ".gitattributes"), "utf8");
    expect(content).toMatch(/\.atlas\/events\.jsonl\s+merge=atlas-spec-graph/);
    expect(content).toMatch(/\.atlas\/spec\.graph\.json\s+merge=atlas-spec-graph/);
  });

  it("appends the two lines when .gitattributes already exists with unrelated content", async () => {
    const repo = await createTmpRepo();
    writeFileSync(join(repo, ".gitattributes"), "*.md text\n");
    await installDriver(repo);
    const content = readFileSync(join(repo, ".gitattributes"), "utf8");
    expect(content).toMatch(/^\*\.md text$/m);
    expect(content).toMatch(/\.atlas\/events\.jsonl\s+merge=atlas-spec-graph/);
  });

  it("is idempotent: running twice does not duplicate lines", async () => {
    const repo = await createTmpRepo();
    await installDriver(repo);
    await installDriver(repo);
    const content = readFileOrEmpty(join(repo, ".gitattributes"));
    const eventsLines = content.split("\n").filter((l) => l.includes(".atlas/events.jsonl"));
    const graphLines = content.split("\n").filter((l) => l.includes(".atlas/spec.graph.json"));
    expect(eventsLines).toHaveLength(1);
    expect(graphLines).toHaveLength(1);
  });

  it("sets the three required git config keys", async () => {
    const repo = await createTmpRepo();
    await installDriver(repo);
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.name")).toBe("Atlas Spec Graph merge driver");
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.driver")).toBe(
      "npx -y @atlas/spec-graph-merge-driver merge %O %A %B %P"
    );
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.recursive")).toBe("binary");
  });

  it("overwrites pre-existing divergent git config values", async () => {
    const repo = await createTmpRepo();
    const { execa } = await import("execa");
    await execa("git", ["config", "merge.atlas-spec-graph.driver", "old-command"], { cwd: repo });
    await installDriver(repo);
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.driver")).toBe(
      "npx -y @atlas/spec-graph-merge-driver merge %O %A %B %P"
    );
  });
});
