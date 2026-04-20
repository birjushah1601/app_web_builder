import { openSync, closeSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export interface FileLockAcquireOptions {
  timeoutMs?: number;
  retryIntervalMs?: number;
}

export class FileLock {
  private readonly path: string;
  private readonly token: string;
  private depth = 0;

  constructor(path: string) {
    this.path = path;
    this.token = randomUUID();
  }

  get held(): boolean {
    return this.depth > 0;
  }

  async acquire(opts: FileLockAcquireOptions = {}): Promise<void> {
    if (this.depth > 0) {
      this.depth += 1;
      return;
    }
    const timeoutMs = opts.timeoutMs ?? 5_000;
    const retryIntervalMs = opts.retryIntervalMs ?? 50;
    const start = Date.now();
    while (true) {
      try {
        const fd = openSync(this.path, "wx"); // exclusive create; fails if exists
        writeFileSync(fd, JSON.stringify({ token: this.token, pid: process.pid, ts: Date.now() }));
        closeSync(fd);
        this.depth = 1;
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        if (Date.now() - start >= timeoutMs) {
          throw new Error(`FileLock.acquire timeout after ${timeoutMs}ms for ${this.path}`);
        }
        await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
      }
    }
  }

  async release(): Promise<void> {
    if (this.depth === 0) return; // idempotent release
    this.depth -= 1;
    if (this.depth > 0) return;
    if (existsSync(this.path)) unlinkSync(this.path);
  }
}
