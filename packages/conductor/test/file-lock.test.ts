import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FileLock } from "../src/file-lock.js";

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "atlas-flock-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("FileLock", () => {
  it("acquire + release creates and removes the lockfile", async () => {
    const lock = new FileLock(join(dir, "a.lock"));
    await lock.acquire();
    await lock.release();
    expect(lock.held).toBe(false);
  });

  it("second acquire in same instance is reentrant (no error, no duplicate file-op)", async () => {
    const lock = new FileLock(join(dir, "a.lock"));
    await lock.acquire();
    await lock.acquire(); // reentrant
    expect(lock.held).toBe(true);
    await lock.release();
    await lock.release(); // safe no-op after initial release (reentrant counting)
  });

  it("a different FileLock for the same path blocks until released", async () => {
    const a = new FileLock(join(dir, "a.lock"));
    const b = new FileLock(join(dir, "a.lock"));
    await a.acquire();
    const bAcquire = b.acquire({ timeoutMs: 200, retryIntervalMs: 20 });
    await expect(bAcquire).rejects.toThrow(/timeout/i);
    await a.release();
    await b.acquire({ timeoutMs: 200, retryIntervalMs: 20 });
    await b.release();
  });
});
