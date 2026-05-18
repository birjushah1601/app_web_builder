"use client";

import React from "react";
import dynamic from "next/dynamic";

// DiffEditor also depends on browser globals
const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((m) => ({ default: m.DiffEditor })),
  { ssr: false, loading: () => <div className="flex h-full items-center justify-center text-zinc-500 text-sm">Loading diff…</div> }
);

export interface PrDiffViewerProps {
  /** Unified diff string as returned by getPrDiff Server Action */
  diff: string;
}

/**
 * Parses a unified diff into original + modified text for Monaco DiffEditor.
 * This is a best-effort renderer — it splits on the first `---`/`+++` boundary.
 * A full diff-parser (e.g. `diff` npm package) can replace this in a follow-up.
 */
function parseDiff(unified: string): { original: string; modified: string } {
  const lines = unified.split("\n");
  const original: string[] = [];
  const modified: string[] = [];

  for (const line of lines) {
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) continue;
    if (line.startsWith("-")) {
      original.push(line.slice(1));
    } else if (line.startsWith("+")) {
      modified.push(line.slice(1));
    } else {
      original.push(line.slice(1));
      modified.push(line.slice(1));
    }
  }

  return { original: original.join("\n"), modified: modified.join("\n") };
}

export function PrDiffViewer({ diff }: PrDiffViewerProps) {
  const { original, modified } = parseDiff(diff);

  return (
    <div className="h-full w-full">
      <DiffEditor
        height="100%"
        original={original}
        modified={modified}
        theme="vs-dark"
        options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }}
      />
    </div>
  );
}
