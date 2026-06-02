import { describe, it, expect, vi } from "vitest";
import { buildAndPushImages, type CommandRunner } from "../src/image-builder.js";

const IMAGES = [
  { serviceName: "api", dockerfilePath: "./services/api/Dockerfile", imageTag: "reg.local/atlas/api:abc" },
  { serviceName: "web", dockerfilePath: "./services/web/Dockerfile", imageTag: "reg.local/atlas/web:abc" },
  { serviceName: "worker", dockerfilePath: "./services/worker/Dockerfile", imageTag: "reg.local/atlas/worker:abc" },
  { serviceName: "cron", dockerfilePath: "./services/cron/Dockerfile", imageTag: "reg.local/atlas/cron:abc" }
];

/**
 * Plan F.5 — parallel builds. The default sequential behavior is exhaustively
 * covered in image-builder.test.ts; here we only assert the opt-in concurrent
 * dispatch path.
 */
describe("buildAndPushImages — parallelism (Plan F.5)", () => {
  it("dispatches up to `parallelism` builds concurrently", async () => {
    // Each call awaits its gate. We resolve gates one-at-a-time after asserting
    // the in-flight count crossed the parallelism threshold.
    const gates: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const runner: CommandRunner = vi.fn(async (_cmd: string, args: string[]) => {
      // Only meter `build` calls — `push` runs after each build resolves.
      if (args[0] === "build") {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
      }
      await new Promise<void>((resolve) => gates.push(resolve));
      if (args[0] === "build") inFlight -= 1;
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    // Kick off the batch.
    const promise = buildAndPushImages(IMAGES, { runner, parallelism: 2, skipPush: true });

    // Yield a few microtasks so the orchestrator dispatches the first batch.
    for (let i = 0; i < 10 && gates.length < 2; i += 1) {
      await Promise.resolve();
    }
    expect(gates.length).toBeGreaterThanOrEqual(2);

    // Drain all gates so the promise can settle.
    while (gates.length > 0) {
      // Drain in waves: open everything we have, then yield, then check again.
      const wave = gates.splice(0);
      for (const open of wave) open();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    }
    const results = await promise;
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.ok)).toBe(true);
    // The whole point: at some moment we had >= 2 builds concurrently in flight.
    expect(maxInFlight).toBeGreaterThanOrEqual(2);
  });

  it("preserves input order in the returned results even with parallelism > 1", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const results = await buildAndPushImages(IMAGES, { runner, parallelism: 3, skipPush: true });
    expect(results.map((r) => r.serviceName)).toEqual(["api", "web", "worker", "cron"]);
  });

  it("with parallelism=1 (default) dispatches sequentially — no concurrent build calls", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const runner: CommandRunner = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "build") {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield to let other promises in this microtask queue race us
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    await buildAndPushImages(IMAGES, { runner, skipPush: true });
    expect(maxInFlight).toBe(1);
  });

  it("treats parallelism < 1 as 1 (defensive)", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const r = await buildAndPushImages(IMAGES, { runner, parallelism: 0, skipPush: true });
    expect(r).toHaveLength(4);
    expect(r.every((x) => x.ok)).toBe(true);
  });

  it("fail-soft per image preserved with parallelism > 1 (one image fails, others succeed)", async () => {
    const runner: CommandRunner = vi.fn(async (_cmd: string, args: string[], _opts) => {
      // Inspect the imageTag (4th positional arg) to know which image we are.
      const tag = args[args.indexOf("-t") + 1] ?? args[args.length - 1] ?? "";
      if (tag.includes("worker") && args[0] === "build") {
        return { stdout: "", stderr: "boom", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const r = await buildAndPushImages(IMAGES, { runner, parallelism: 2, skipPush: true });
    expect(r).toHaveLength(4);
    const worker = r.find((x) => x.serviceName === "worker");
    expect(worker?.ok).toBe(false);
    expect(worker?.error).toMatch(/boom/);
    expect(r.filter((x) => x.ok)).toHaveLength(3);
  });
});
