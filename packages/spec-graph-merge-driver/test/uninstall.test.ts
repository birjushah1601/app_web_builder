import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installDriver } from "../src/install/install.js";
import { uninstallDriver } from "../src/install/uninstall.js";
import { createTmpRepo, gitConfigGet } from "./helpers.js";

describe("uninstallDriver", () => {
  it("removes both atlas lines from .gitattributes, preserving other content", async () => {
    const repo = await createTmpRepo();
    writeFileSync(join(repo, ".gitattributes"), "*.md text\n");
    await installDriver(repo);
    await uninstallDriver(repo);
    const content = readFileSync(join(repo, ".gitattributes"), "utf8");
    expect(content).toMatch(/^\*\.md text$/m);
    expect(content).not.toMatch(/\.atlas\/events\.jsonl/);
    expect(content).not.toMatch(/\.atlas\/spec\.graph\.json/);
  });

  it("deletes .gitattributes entirely if it becomes empty", async () => {
    const repo = await createTmpRepo();
    await installDriver(repo);
    await uninstallDriver(repo);
    expect(existsSync(join(repo, ".gitattributes"))).toBe(false);
  });

  it("unsets all three git config keys", async () => {
    const repo = await createTmpRepo();
    await installDriver(repo);
    await uninstallDriver(repo);
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.name")).toBeUndefined();
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.driver")).toBeUndefined();
    expect(await gitConfigGet(repo, "merge.atlas-spec-graph.recursive")).toBeUndefined();
  });

  it("is idempotent: running twice does not error", async () => {
    const repo = await createTmpRepo();
    await installDriver(repo);
    await uninstallDriver(repo);
    await expect(uninstallDriver(repo)).resolves.toBeUndefined();
  });

  it("leaves a repo that never had the driver installed unchanged", async () => {
    const repo = await createTmpRepo();
    await expect(uninstallDriver(repo)).resolves.toBeUndefined();
    expect(existsSync(join(repo, ".gitattributes"))).toBe(false);
  });
});
