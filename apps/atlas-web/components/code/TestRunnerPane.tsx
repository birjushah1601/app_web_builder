"use client";

import React, { useEffect, useState } from "react";
import { getTestResults, type GetTestResultsResult } from "../../lib/actions/code/getTestResults";
import type { SandboxExec } from "@atlas/sandbox-e2b";
import type { SandboxId } from "@atlas/sandbox-e2b";

export interface TestRunnerPaneProps {
  projectId: string;
  /** E.4: When provided, stream vitest output from the real sandbox instead of using the E.3 stub. */
  sandboxId?: SandboxId;
  /** E.4: Injected SandboxExec — allows tests to pass a mock without touching the factory. */
  sandboxExec?: Pick<SandboxExec, "streamCommand">;
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "done" ? "bg-green-600" : status === "running" ? "bg-blue-500 animate-pulse" : "bg-zinc-600";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs text-white ${color}`}>{status}</span>;
}

/**
 * Client Component. Displays vitest results from the E2B sandbox.
 * In E.3 the backend stub returns status: "stub" with an empty suite list.
 * E.4 adds a real vitest stream via SandboxExec.streamCommand when sandboxId is provided.
 */
export function TestRunnerPane({ projectId, sandboxId, sandboxExec }: TestRunnerPaneProps) {
  const [results, setResults] = useState<GetTestResultsResult | null>(null);
  const [running, setRunning] = useState(false);
  const [streamOutput, setStreamOutput] = useState<string[]>([]);

  useEffect(() => {
    if (!sandboxId) {
      // Fallback to E.3 stub behaviour
      getTestResults({ projectId }).then(setResults);
    }
  }, [projectId, sandboxId]);

  async function runTests() {
    if (!sandboxId || !sandboxExec) return;
    setRunning(true);
    setStreamOutput([]);
    try {
      for await (const chunk of sandboxExec.streamCommand(
        sandboxId,
        "npx vitest run --reporter=verbose",
        { cwd: "/app" }
      )) {
        setStreamOutput((prev) => [...prev, chunk.data]);
      }
    } finally {
      setRunning(false);
    }
  }

  // Sandbox-wired mode
  if (sandboxId && sandboxExec) {
    return (
      <div className="flex h-full flex-col gap-2 overflow-y-auto p-3 text-sm text-zinc-200">
        <div className="flex items-center gap-2">
          <span className="font-medium">Test Runner</span>
          <StatusBadge status={running ? "running" : "idle"} />
          <button
            type="button"
            onClick={runTests}
            disabled={running}
            className="ml-auto rounded bg-zinc-700 px-2 py-0.5 text-xs hover:bg-zinc-600 disabled:opacity-50"
          >
            Run tests
          </button>
        </div>
        <pre className="flex-1 overflow-y-auto text-xs text-zinc-300 whitespace-pre-wrap">
          {streamOutput.join("")}
        </pre>
      </div>
    );
  }

  // E.3 stub mode
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
