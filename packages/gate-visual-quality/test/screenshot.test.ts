import { describe, it, expect, vi } from "vitest";
import { captureScreenshots, type SandboxExec } from "../src/screenshot.js";
import { ScreenshotFailedError } from "../src/errors.js";

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
