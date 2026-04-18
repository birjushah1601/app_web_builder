import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createDatabase, SpecEventRepo, SpecGraphRepo, type Database } from "@atlas/spec-graph-data";
import { appendEventLine, createProjectFixture, seedGraph, truncateAll, waitFor, type ProjectFixture } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = resolve(__dirname, "..", "bin", "atlas-sync.js");

describe("atlas-sync CLI", () => {
  let db: Database;
  let fx: ProjectFixture;
  let graphRepo: SpecGraphRepo;
  let eventRepo: SpecEventRepo;

  beforeAll(() => {
    db = createDatabase(process.env.DATABASE_URL_TEST!);
    graphRepo = new SpecGraphRepo(db.pool);
    eventRepo = new SpecEventRepo(db.pool);
  });

  beforeEach(async () => {
    await truncateAll(db);
    fx = createProjectFixture();
    await seedGraph(db, fx.projectId);
  });

  afterAll(async () => {
    fx.cleanup();
    await db.pool.end();
  });

  it("exits non-zero when required args are missing", async () => {
    const result = await execa("node", [CLI_ENTRY], { reject: false });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--project-dir/);
  });

  it("starts, propagates an event, and shuts down cleanly on SIGINT", async () => {
    const child = execa(
      "node",
      [
        CLI_ENTRY,
        "--project-dir", fx.projectDir,
        "--project-id", fx.projectId,
        "--database-url", process.env.DATABASE_URL_TEST!,
        "--debounce-ms", "50"
      ],
      { buffer: true }
    );

    // Wait for the "watching" log line
    await waitFor(() => (child.stdout?.read() ? true : false), { timeoutMs: 5_000 }).catch(() => undefined);
    // Cheaper: just sleep 500ms for ready
    await new Promise((r) => setTimeout(r, 500));

    appendEventLine(fx.eventsPath, { eventType: "cli-test", payload: {}, actor: null });
    await waitFor(async () => (await eventRepo.listSince(fx.projectId, 0n)).length > 0, { timeoutMs: 5_000 });

    child.kill("SIGINT");
    // On Windows, kill("SIGINT") calls TerminateProcess() — the child cannot handle
    // the signal and call process.exit(0). On POSIX the handler runs normally.
    const result = await child.catch((e: any) => e);
    if (process.platform === "win32") {
      const isCleanExit = result.exitCode === 0;
      const isSignalKilled = result.isTerminated === true && result.signal === "SIGINT";
      expect(isCleanExit || isSignalKilled).toBe(true);
    } else {
      expect(result.exitCode).toBe(0);
    }
  });

  it("rejects an invalid project-id (not a UUID)", async () => {
    const result = await execa(
      "node",
      [
        CLI_ENTRY,
        "--project-dir", fx.projectDir,
        "--project-id", "not-a-uuid",
        "--database-url", process.env.DATABASE_URL_TEST!
      ],
      { reject: false, timeout: 5_000 }
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/uuid/i);
  });
});
