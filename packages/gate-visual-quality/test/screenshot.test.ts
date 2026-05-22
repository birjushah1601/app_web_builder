import { describe, it, expect, vi } from "vitest";
import { captureScreenshots, type SandboxExec } from "../src/screenshot.js";
import { ScreenshotFailedError, InfrastructureUnavailableError } from "../src/errors.js";

const fakeExec = (results: Record<string, { stdout: string; exitCode: number }>) =>
  ({
    runCommand: vi.fn().mockImplementation(async (cmd: string) => {
      for (const [match, res] of Object.entries(results)) {
        if (cmd.includes(match)) return res;
      }
      return { stdout: "", exitCode: 0 };
    })
  } as unknown as SandboxExec);

describe("captureScreenshots", () => {
  it("invokes puppeteer-core for each of 3 viewports", async () => {
    const exec = fakeExec({
      desktop: { stdout: "BASE64_DESKTOP", exitCode: 0 },
      tablet: { stdout: "BASE64_TABLET", exitCode: 0 },
      mobile: { stdout: "BASE64_MOBILE", exitCode: 0 }
    });
    const result = await captureScreenshots({ exec, previewUrl: "http://localhost:3000" });
    expect(result.desktop).toContain("BASE64_DESKTOP");
    expect(result.tablet).toContain("BASE64_TABLET");
    expect(result.mobile).toContain("BASE64_MOBILE");
    expect((exec as unknown as { runCommand: ReturnType<typeof vi.fn> }).runCommand).toHaveBeenCalledTimes(3);
  });

  it("returns base64 data URLs (data:image/jpeg;base64,...)", async () => {
    const exec = fakeExec({
      desktop: { stdout: "AAAA", exitCode: 0 },
      tablet: { stdout: "BBBB", exitCode: 0 },
      mobile: { stdout: "CCCC", exitCode: 0 }
    });
    const result = await captureScreenshots({ exec, previewUrl: "http://localhost:3000" });
    expect(result.desktop).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("throws ScreenshotFailedError when a viewport fails", async () => {
    const exec = {
      runCommand: vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd.includes("tablet")) return { stdout: "", exitCode: 1, stderr: "puppeteer crashed" };
        return { stdout: "OK", exitCode: 0 };
      })
    } as unknown as SandboxExec;
    await expect(captureScreenshots({ exec, previewUrl: "http://localhost:3000" })).rejects.toThrow(ScreenshotFailedError);
  });

  it("includes the viewport name in the error", async () => {
    const exec = {
      runCommand: vi.fn().mockImplementation(async (cmd: string) => {
        if (cmd.includes("mobile")) return { stdout: "", exitCode: 1, stderr: "x" };
        return { stdout: "OK", exitCode: 0 };
      })
    } as unknown as SandboxExec;
    await expect(captureScreenshots({ exec, previewUrl: "http://localhost:3000" })).rejects.toThrow(/mobile/);
  });

  it("throws InfrastructureUnavailableError when stderr says puppeteer-core is missing", async () => {
    const exec = {
      runCommand: vi.fn().mockResolvedValue({
        stdout: "",
        exitCode: 1,
        stderr: "Error: Cannot find module 'puppeteer-core'\nRequire stack:\n- /code/.atlas/visual-quality-check.js"
      })
    } as unknown as SandboxExec;
    await expect(captureScreenshots({ exec, previewUrl: "http://localhost:3000" })).rejects.toThrow(InfrastructureUnavailableError);
  });

  it("throws InfrastructureUnavailableError on a generic MODULE_NOT_FOUND signal", async () => {
    const exec = {
      runCommand: vi.fn().mockResolvedValue({
        stdout: "",
        exitCode: 1,
        stderr: "Error: MODULE_NOT_FOUND while loading 'puppeteer-core'"
      })
    } as unknown as SandboxExec;
    await expect(captureScreenshots({ exec, previewUrl: "http://localhost:3000" })).rejects.toThrow(InfrastructureUnavailableError);
  });

  it("throws InfrastructureUnavailableError when chromium executable path can't launch", async () => {
    const exec = {
      runCommand: vi.fn().mockResolvedValue({
        stdout: "",
        exitCode: 1,
        stderr: "Error: Failed to launch the browser process! spawn /usr/bin/chromium ENOENT"
      })
    } as unknown as SandboxExec;
    await expect(captureScreenshots({ exec, previewUrl: "http://localhost:3000" })).rejects.toThrow(InfrastructureUnavailableError);
  });

  it("still throws ScreenshotFailedError (NOT Infrastructure) on generic puppeteer crash with no infra signature", async () => {
    const exec = {
      runCommand: vi.fn().mockResolvedValue({
        stdout: "",
        exitCode: 1,
        stderr: "Error: Navigation timeout of 15000 ms exceeded"
      })
    } as unknown as SandboxExec;
    const err = await captureScreenshots({ exec, previewUrl: "http://localhost:3000" }).catch((e) => e);
    expect(err).toBeInstanceOf(ScreenshotFailedError);
    expect(err).not.toBeInstanceOf(InfrastructureUnavailableError);
  });

  it("uses correct viewport dimensions in the puppeteer command", async () => {
    const exec = fakeExec({
      desktop: { stdout: "x", exitCode: 0 },
      tablet: { stdout: "x", exitCode: 0 },
      mobile: { stdout: "x", exitCode: 0 }
    });
    await captureScreenshots({ exec, previewUrl: "http://localhost:3000" });
    const calls = (exec as unknown as { runCommand: ReturnType<typeof vi.fn> }).runCommand.mock.calls;
    const cmds = calls.map((c) => c[0]);
    expect(cmds.some((c) => c.includes("1280") && c.includes("800"))).toBe(true);
    expect(cmds.some((c) => c.includes("768") && c.includes("1024"))).toBe(true);
    expect(cmds.some((c) => c.includes("375") && c.includes("667"))).toBe(true);
  });
});
