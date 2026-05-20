import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { createColdStorage } from "../src/compaction/cold-storage.js";
import { makeTempColdStorageDir, uniqueProjectId } from "./helpers.js";

describe("cold-storage filesystem adapter", () => {
  let workspace: ReturnType<typeof makeTempColdStorageDir>;

  beforeEach(() => {
    workspace = makeTempColdStorageDir();
  });

  afterEach(() => {
    workspace.cleanup();
  });

  it("writes a .jsonl.gz archive at <dir>/<projectId>/<from>-<to>.jsonl.gz", async () => {
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const projectId = uniqueProjectId();
    const lines = [
      JSON.stringify({ id: "1", event_type: "x" }),
      JSON.stringify({ id: "2", event_type: "y" })
    ];

    const { key, bytes } = await storage.putArchive({
      projectId,
      fromEventId: 1n,
      toEventId: 2n,
      jsonl: lines.join("\n") + "\n"
    });

    expect(key).toMatch(/^[0-9a-f-]{36}\/00000000000000000001-00000000000000000002\.jsonl\.gz$/);
    expect(bytes).toBeGreaterThan(0);

    const path = join(workspace.dir, key);
    expect(existsSync(path)).toBe(true);
    const decompressed = gunzipSync(readFileSync(path)).toString("utf8");
    expect(decompressed).toBe(lines.join("\n") + "\n");
  });

  it("reads an archive back via getArchive", async () => {
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const projectId = uniqueProjectId();
    const payload = "{\"a\":1}\n{\"b\":2}\n";

    const { key } = await storage.putArchive({
      projectId,
      fromEventId: 10n,
      toEventId: 20n,
      jsonl: payload
    });
    const result = await storage.getArchive(key);
    expect(result).toBe(payload);
  });

  it("deleteArchive removes the file", async () => {
    const storage = createColdStorage({ kind: "fs", dir: workspace.dir });
    const projectId = uniqueProjectId();
    const { key } = await storage.putArchive({ projectId, fromEventId: 1n, toEventId: 1n, jsonl: "{}\n" });
    await storage.deleteArchive(key);
    expect(existsSync(join(workspace.dir, key))).toBe(false);
  });
});
