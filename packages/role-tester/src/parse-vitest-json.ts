export interface NormalizedSpecResult {
  file: string;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  lastError?: string;
}

interface VitestAssertion {
  status?: unknown;
  duration?: unknown;
  failureMessages?: unknown;
}

interface VitestTestResult {
  name?: unknown;
  assertionResults?: unknown;
}

export function parseVitestJson(stdout: string): NormalizedSpecResult[] {
  let raw: unknown;
  try { raw = JSON.parse(stdout); } catch { return []; }
  if (!raw || typeof raw !== "object") return [];
  const testResults = (raw as { testResults?: unknown }).testResults;
  if (!Array.isArray(testResults)) return [];

  const out: NormalizedSpecResult[] = [];
  for (const tr of testResults as VitestTestResult[]) {
    if (!tr || typeof tr !== "object") continue;
    const file = typeof tr.name === "string" ? tr.name : undefined;
    if (!file) continue;
    const assertions = Array.isArray(tr.assertionResults) ? (tr.assertionResults as VitestAssertion[]) : [];
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let durationMs = 0;
    let lastError: string | undefined;
    for (const a of assertions) {
      if (!a || typeof a !== "object") continue;
      if (a.status === "passed") passed++;
      else if (a.status === "failed") {
        failed++;
        if (!lastError && Array.isArray(a.failureMessages) && a.failureMessages.length > 0) {
          const m = a.failureMessages[0];
          if (typeof m === "string") lastError = m;
        }
      } else if (a.status === "pending" || a.status === "skipped") skipped++;
      if (typeof a.duration === "number") durationMs += a.duration;
    }
    out.push({
      file,
      passed,
      failed,
      skipped,
      durationMs,
      ...(lastError !== undefined ? { lastError } : {})
    });
  }
  return out;
}
