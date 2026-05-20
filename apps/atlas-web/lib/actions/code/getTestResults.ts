"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getSandboxFactory } from "@/lib/sandbox/factory";

/** Per-file aggregate matching the existing TestRunnerPane consumer. */
export interface VitestSuiteResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

export interface GetTestResultsInput {
  projectId: string;
}

/**
 * Discriminated-ish result shape; `suites` is always present (possibly empty)
 * so the UI can iterate without branching on `status` first.
 */
export interface GetTestResultsResult {
  status: "stub" | "running" | "done" | "raw" | "timeout" | "error";
  suites: VitestSuiteResult[];
  message?: string;
  /** Raw stdout, surfaced when JSON parsing fails (status: "raw"). */
  output?: string;
  /** Sandbox process exitCode when status is "raw" or "error". */
  exitCode?: number;
}

/** Vitest --reporter=json shape (subset). */
interface VitestJsonAssertion {
  title?: string;
  status?: string;
  duration?: number;
}
interface VitestJsonTestResult {
  name?: string;
  startTime?: number;
  endTime?: number;
  assertionResults?: VitestJsonAssertion[];
}
interface VitestJsonReport {
  testResults?: VitestJsonTestResult[];
}

const TEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const TEST_COMMAND = "pnpm test --reporter=json --silent 2>/dev/null";
const RAW_FALLBACK_COMMAND = "pnpm test";

/**
 * Aggregates a Vitest --reporter=json report into per-file VitestSuiteResult.
 * Returns null when the JSON shape doesn't look like a Vitest report — caller
 * should fall back to the raw-output path.
 */
function aggregateVitestJson(report: VitestJsonReport): VitestSuiteResult[] | null {
  if (!report || !Array.isArray(report.testResults)) return null;
  return report.testResults.map((file) => {
    const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let duration = 0;
    for (const a of assertions) {
      const status = a.status ?? "";
      if (status === "passed") passed += 1;
      else if (status === "failed") failed += 1;
      else if (status === "skipped" || status === "pending" || status === "todo") skipped += 1;
      if (typeof a.duration === "number") duration += a.duration;
    }
    if (duration === 0 && typeof file.startTime === "number" && typeof file.endTime === "number") {
      duration = Math.max(0, file.endTime - file.startTime);
    }
    return {
      name: file.name ?? "(unknown)",
      passed,
      failed,
      skipped,
      duration,
    };
  });
}

/**
 * Plan E.4 — runs `pnpm test --reporter=json` inside the project's E2B
 * sandbox and aggregates the result into per-file VitestSuiteResult.
 *
 * exitCode 0 (all tests passed) and 1 (some tests failed) are both treated
 * as completions — Vitest emits its JSON report on both paths. Any other
 * exitCode, parse failure, or non-Vitest JSON triggers a raw-output fallback.
 */
export async function getTestResults(
  input: GetTestResultsInput
): Promise<GetTestResultsResult> {
  const { userId } = await auth();
  if (!userId) throw new Error("UNAUTHORIZED");

  const session = await getSandboxFactory().getOrProvision(input.projectId);
  const { Sandbox } = await import("@e2b/sdk");
  const sandbox = (await Sandbox.connect(session.record.sandboxId, {
    apiKey: process.env.E2B_API_KEY ?? "",
  })) as unknown as {
    commands: {
      run: (
        cmd: string,
        opts?: { timeoutMs?: number }
      ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
    };
  };

  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await sandbox.commands.run(TEST_COMMAND, { timeoutMs: TEST_TIMEOUT_MS });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|timed out/i.test(msg)) {
      return { status: "timeout", suites: [], message: `pnpm test exceeded ${TEST_TIMEOUT_MS}ms` };
    }
    return { status: "error", suites: [], message: msg };
  }

  // exitCode 0 (green) and 1 (red but completed) both yield valid JSON reports.
  if (result.exitCode === 0 || result.exitCode === 1) {
    try {
      const parsed = JSON.parse(result.stdout) as VitestJsonReport;
      const suites = aggregateVitestJson(parsed);
      if (suites) {
        return { status: "done", suites };
      }
    } catch {
      // fall through to raw-fallback
    }
  }

  // Fallback — JSON unparseable or unexpected exitCode. Re-run plain `pnpm test`
  // so the user sees human-readable output instead of an opaque JSON-mode crash.
  try {
    const raw = await sandbox.commands.run(RAW_FALLBACK_COMMAND, { timeoutMs: TEST_TIMEOUT_MS });
    return {
      status: "raw",
      suites: [],
      output: raw.stdout + (raw.stderr ? `\n${raw.stderr}` : ""),
      exitCode: raw.exitCode,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|timed out/i.test(msg)) {
      return { status: "timeout", suites: [], message: `pnpm test exceeded ${TEST_TIMEOUT_MS}ms` };
    }
    return {
      status: "raw",
      suites: [],
      output: result.stdout + (result.stderr ? `\n${result.stderr}` : ""),
      exitCode: result.exitCode,
    };
  }
}
