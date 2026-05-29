import type { TestsArtifact } from "@atlas/workflow-engine";
import type { NormalizedSpecResult } from "./parse-vitest-json.js";

export interface BuildTestsArtifactInput {
  framework: TestsArtifact["framework"];
  results: ReadonlyArray<NormalizedSpecResult>;
  targetsBySpec: Record<string, ReadonlyArray<string>>;
  coverage?: { lines: number; branches: number };
}

export function buildTestsArtifact(input: BuildTestsArtifactInput): TestsArtifact {
  return {
    schemaVersion: "1",
    kind: "tests",
    framework: input.framework,
    specs: input.results.map((r) => ({
      file: r.file,
      targets: [...(input.targetsBySpec[r.file] ?? [])],
      passed: r.passed,
      failed: r.failed,
      skipped: r.skipped,
      durationMs: r.durationMs,
      ...(r.lastError !== undefined ? { lastError: r.lastError } : {})
    })),
    ...(input.coverage ? { coverage: input.coverage } : {})
  };
}
