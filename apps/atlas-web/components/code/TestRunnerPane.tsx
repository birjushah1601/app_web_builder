"use client";

import React, { useEffect, useState } from "react";
import { getTestResults, type GetTestResultsResult } from "../../lib/actions/code/getTestResults.js";

export interface TestRunnerPaneProps {
  projectId: string;
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "done" ? "bg-green-600" : status === "running" ? "bg-blue-500 animate-pulse" : "bg-zinc-600";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs text-white ${color}`}>{status}</span>;
}

/**
 * Client Component. Displays vitest results from the E2B sandbox.
 * In E.3 the backend stub returns status: "stub" with an empty suite list.
 * Plan E.4 wires the real test-runner stream.
 */
export function TestRunnerPane({ projectId }: TestRunnerPaneProps) {
  const [results, setResults] = useState<GetTestResultsResult | null>(null);

  useEffect(() => {
    getTestResults({ projectId }).then(setResults);
    // TODO(E.4): replace with a streaming SSE or WebSocket listener
  }, [projectId]);

  if (!results) {
    return <div className="flex h-full items-center justify-center text-xs text-zinc-500">Loading…</div>;
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-3 text-sm text-zinc-200">
      <div className="flex items-center gap-2">
        <span className="font-medium">Test Runner</span>
        <StatusBadge status={results.status} />
      </div>

      {results.message && (
        <p className="text-xs text-amber-400">{results.message}</p>
      )}

      {results.suites.length === 0 && results.status !== "stub" && (
        <p className="text-xs text-zinc-500">No test suites found.</p>
      )}

      {results.suites.map((suite) => (
        <div key={suite.name} className="rounded border border-zinc-700 bg-zinc-800 p-2">
          <div className="flex items-center justify-between">
            <span className="truncate font-medium">{suite.name}</span>
            <span className="text-xs text-zinc-400">{suite.duration}ms</span>
          </div>
          <div className="mt-1 flex gap-3 text-xs">
            <span className="text-green-400">{suite.passed} passed</span>
            {suite.failed > 0 && <span className="text-red-400">{suite.failed} failed</span>}
            {suite.skipped > 0 && <span className="text-zinc-400">{suite.skipped} skipped</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
