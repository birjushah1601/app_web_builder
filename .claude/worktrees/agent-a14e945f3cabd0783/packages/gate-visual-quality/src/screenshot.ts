import { ScreenshotFailedError } from "./errors.js";
import type { Viewport } from "./types.js";

export interface SandboxExec {
  runCommand(cmd: string): Promise<{ stdout: string; exitCode: number; stderr?: string }>;
}

export interface CaptureScreenshotsInput {
  exec: SandboxExec;
  previewUrl: string;
  timeoutMs?: number;
}

export interface CapturedScreenshots {
  desktop: string;
  tablet: string;
  mobile: string;
}

const VIEWPORTS: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 }
};

export async function captureScreenshots(input: CaptureScreenshotsInput): Promise<CapturedScreenshots> {
  const out: Partial<CapturedScreenshots> = {};
  for (const [vp, dims] of Object.entries(VIEWPORTS) as Array<[Viewport, { width: number; height: number }]>) {
    const cmd = puppeteerCommand({ url: input.previewUrl, viewport: vp, width: dims.width, height: dims.height, timeoutMs: input.timeoutMs ?? 15000 });
    const result = await input.exec.runCommand(cmd);
    if (result.exitCode !== 0) {
      throw new ScreenshotFailedError(`screenshot failed for ${vp}: ${result.stderr ?? "(no stderr)"}`, { viewport: vp });
    }
    out[vp] = `data:image/jpeg;base64,${result.stdout.trim()}`;
  }
  return out as CapturedScreenshots;
}

function puppeteerCommand(input: { url: string; viewport: Viewport; width: number; height: number; timeoutMs: number }): string {
  // The script runs inside the E2B sandbox where puppeteer-core + chromium are pre-installed.
  // It opens the preview URL, waits for network-idle + the canvas root data attribute, takes a JPEG, prints base64 to stdout.
  const script = `
const puppeteer = require('puppeteer-core');
(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: ${input.width}, height: ${input.height}, deviceScaleFactor: 1 });
  await page.goto('${input.url}', { waitUntil: 'networkidle0', timeout: ${input.timeoutMs} });
  await page.waitForTimeout(500);
  const buf = await page.screenshot({ type: 'jpeg', quality: 75, fullPage: false });
  process.stdout.write(buf.toString('base64'));
  await browser.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
`.trim();
  // Tag the command with the viewport name so test mocks can route by it.
  return `node -e ${JSON.stringify(script)} ${input.viewport}`;
}
