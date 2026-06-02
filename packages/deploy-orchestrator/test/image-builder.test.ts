import { describe, it, expect, vi } from "vitest";
import { buildAndPushImages, type CommandRunner } from "../src/image-builder.js";

const IMAGES = [
  { serviceName: "api", dockerfilePath: "./services/api/Dockerfile", imageTag: "reg.local/atlas/api:abc123" },
  { serviceName: "web", dockerfilePath: "./services/web/Dockerfile", imageTag: "reg.local/atlas/web:abc123" }
];

describe("buildAndPushImages", () => {
  it("returns ok=true for every image when build + push succeed", async () => {
    const runner: CommandRunner = vi.fn(async () => ({
      stdout: "Pushed\ndigest: sha256:deadbeef size: 1234",
      stderr: "",
      exitCode: 0
    }));
    const r = await buildAndPushImages(IMAGES, { runner });
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.ok)).toBe(true);
    expect(r[0]?.serviceName).toBe("api");
    expect(r[0]?.digest).toBe("sha256:deadbeef");
  });

  it("invokes docker build with -t imageTag and -f dockerfilePath", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    await buildAndPushImages([IMAGES[0]!], { runner, cwd: "/tmp/build" });
    expect(runner).toHaveBeenCalledWith(
      "docker",
      ["build", "-t", "reg.local/atlas/api:abc123", "-f", "./services/api/Dockerfile", "/tmp/build"],
      expect.objectContaining({ cwd: "/tmp/build" })
    );
  });

  it("invokes docker push with imageTag after a successful build", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    await buildAndPushImages([IMAGES[0]!], { runner });
    expect(runner).toHaveBeenNthCalledWith(
      2,
      "docker",
      ["push", "reg.local/atlas/api:abc123"],
      expect.any(Object)
    );
  });

  it("skips push when skipPush=true", async () => {
    const runner: CommandRunner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    await buildAndPushImages([IMAGES[0]!], { runner, skipPush: true });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["build"]),
      expect.any(Object)
    );
  });

  it("returns ok=false with stderr in error when build fails", async () => {
    const runner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "no such file: ./missing/Dockerfile",
      exitCode: 1
    }));
    const r = await buildAndPushImages([IMAGES[0]!], { runner });
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.error).toMatch(/no such file/);
  });

  it("does NOT push when build fails", async () => {
    const runner: CommandRunner = vi.fn(async () => ({
      stdout: "",
      stderr: "build error",
      exitCode: 1
    }));
    await buildAndPushImages([IMAGES[0]!], { runner });
    expect(runner).toHaveBeenCalledTimes(1); // only the failed build call
  });

  it("returns ok=false when push fails (build OK + push non-zero)", async () => {
    const runner: CommandRunner = vi.fn(async (_cmd: string, args: string[]) => {
      if (args[0] === "build") return { stdout: "", stderr: "", exitCode: 0 };
      return { stdout: "", stderr: "denied: requested access to the resource is denied", exitCode: 1 };
    });
    const r = await buildAndPushImages([IMAGES[0]!], { runner });
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.error).toMatch(/denied/);
  });

  it("returns ok=true with digest undefined when push stdout has no digest line", async () => {
    const runner: CommandRunner = vi.fn(async () => ({
      stdout: "Pushed (no digest)\n",
      stderr: "",
      exitCode: 0
    }));
    const r = await buildAndPushImages([IMAGES[0]!], { runner });
    expect(r[0]?.ok).toBe(true);
    expect(r[0]?.digest).toBeUndefined();
  });

  it("processes every image even when one fails (sequential, fail-soft)", async () => {
    let call = 0;
    const runner: CommandRunner = vi.fn(async () => {
      call += 1;
      if (call === 1) return { stdout: "", stderr: "boom", exitCode: 1 }; // api build fails
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const r = await buildAndPushImages(IMAGES, { runner });
    expect(r).toHaveLength(2);
    expect(r[0]?.ok).toBe(false);
    expect(r[1]?.ok).toBe(true);
  });

  it("returns empty array when images is empty", async () => {
    const r = await buildAndPushImages([], {});
    expect(r).toEqual([]);
  });

  it("surfaces a runner throw as ok=false (rather than rejecting)", async () => {
    const runner: CommandRunner = vi.fn(async () => {
      throw new Error("ENOENT: docker not installed");
    });
    const r = await buildAndPushImages([IMAGES[0]!], { runner });
    expect(r[0]?.ok).toBe(false);
    expect(r[0]?.error).toMatch(/ENOENT/);
  });
});
