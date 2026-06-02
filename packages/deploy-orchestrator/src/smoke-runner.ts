import type { DeployArtifact, SmokeTestResult } from "@atlas/workflow-engine";

export type SmokeFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface RunSmokeTestsInput {
  deployArtifact: DeployArtifact;
  publicUrl: string;
  fetcher?: SmokeFetcher;
  perSmokeTimeoutMs?: number;
}

const BODY_EXCERPT_MAX = 200;
const DEFAULT_TIMEOUT_MS = 10_000;

export async function runSmokeTests(input: RunSmokeTestsInput): Promise<SmokeTestResult[]> {
  const fetcher = input.fetcher ?? ((u, i) => fetch(u, i));
  const timeoutMs = input.perSmokeTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results: SmokeTestResult[] = [];

  for (const smoke of input.deployArtifact.smokeTests) {
    const method = (smoke.method ?? "get") as SmokeTestResult["method"];
    const httpMethod = method.toUpperCase();
    const targetUrl = `${input.publicUrl}${smoke.url}`;
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let status = 0;
    let ok = false;
    let bodyExcerpt: string | undefined;
    let error: string | undefined;

    try {
      const res = await fetcher(targetUrl, { method: httpMethod, signal: controller.signal });
      status = res.status;
      const text = await res.text().catch(() => "");
      bodyExcerpt = text.slice(0, BODY_EXCERPT_MAX);

      const statusMatches = status === smoke.expectStatus;
      const bodyMatches = smoke.expectBodyContains
        ? text.includes(smoke.expectBodyContains)
        : true;
      ok = statusMatches && bodyMatches;

      if (!statusMatches) {
        error = `status ${status} did not match expected ${smoke.expectStatus}`;
      } else if (!bodyMatches) {
        error = `body did not contain "${smoke.expectBodyContains}"`;
      }
    } catch (err) {
      status = 0;
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - startedAt;

    const result: SmokeTestResult = {
      url: smoke.url,
      method,
      status,
      ok,
      latencyMs,
      expectStatus: smoke.expectStatus,
      ...(smoke.expectBodyContains !== undefined ? { expectBodyContains: smoke.expectBodyContains } : {}),
      ...(bodyExcerpt !== undefined ? { bodyExcerpt } : {}),
      ...(error !== undefined ? { error } : {})
    };
    results.push(result);
  }

  return results;
}
