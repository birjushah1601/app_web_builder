"use client";

import type { TestsArtifact } from "@atlas/workflow-engine";

export interface TestsCanvasProps {
  artifact?: TestsArtifact;
}

const PASS = "bg-emerald-100 border-emerald-300 text-emerald-900";
const FAIL = "bg-red-100 border-red-300 text-red-900";
const SKIP = "bg-slate-100 border-slate-300 text-slate-700";

export function TestsCanvas({ artifact }: TestsCanvasProps) {
  if (!artifact) {
    return (
      <div
        data-testid="tests-canvas-empty"
        className="flex h-full w-full items-center justify-center bg-slate-50 p-8 text-sm text-slate-700"
      >
        Test results not yet available. Waiting for the tester ritual to finish…
      </div>
    );
  }

  const totals = artifact.specs.reduce(
    (acc, s) => ({
      passed: acc.passed + s.passed,
      failed: acc.failed + s.failed,
      skipped: acc.skipped + s.skipped,
      durationMs: acc.durationMs + s.durationMs
    }),
    { passed: 0, failed: 0, skipped: 0, durationMs: 0 }
  );

  return (
    <div className="flex h-full w-full flex-col">
      <header
        data-testid="tests-summary"
        className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-2 text-xs"
      >
        <span className="font-mono text-slate-700">{artifact.framework}</span>
        <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-900">
          {totals.passed} passed
        </span>
        <span className="rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-red-900">
          {totals.failed} failed
        </span>
        <span className="rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 text-slate-700">
          {totals.skipped} skipped
        </span>
        <span className="ml-auto text-[11px] text-slate-500">
          {(totals.durationMs / 1000).toFixed(2)}s
        </span>
      </header>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-1 font-medium">Spec</th>
              <th className="px-3 py-1 font-medium">Status</th>
              <th className="px-3 py-1 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {artifact.specs.map((s) => {
              const status = s.failed > 0 ? "failed" : s.passed > 0 ? "passed" : "skipped";
              const klass = status === "failed" ? FAIL : status === "passed" ? PASS : SKIP;
              return (
                <tr
                  key={s.file}
                  data-testid={`tests-spec-row-${s.file}`}
                  className="border-t border-slate-100 align-top"
                >
                  <td className="px-3 py-1 font-mono text-slate-800">{s.file}</td>
                  <td className="px-3 py-1">
                    <span className={`rounded border px-2 py-0.5 ${klass}`}>{status}</span>
                  </td>
                  <td className="px-3 py-1 text-slate-500">{(s.durationMs / 1000).toFixed(2)}s</td>
                  {s.lastError && (
                    <td
                      colSpan={3}
                      data-testid={`tests-spec-error-${s.file}`}
                      className="px-3 pb-2 text-[11px] text-red-700"
                    >
                      {s.lastError}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {artifact.coverage && (
        <footer
          data-testid="tests-coverage"
          className="border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600"
        >
          coverage: lines {artifact.coverage.lines.toFixed(1)}% · branches {artifact.coverage.branches.toFixed(1)}%
        </footer>
      )}
    </div>
  );
}
