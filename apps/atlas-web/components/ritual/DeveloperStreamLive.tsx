"use client";
/**
 * DeveloperStreamLive — renders the developer's Anthropic candidate output
 * as it streams in. Subscribes to `developer.candidate.delta` SSE events
 * via useDeveloperStream and shows the accumulated text in a code block.
 *
 * The streamed text is JSON-wrapped (the proxy drops `tools` so the model
 * emits `{"diff": "...", "summary": "..."}` as content). We don't try to
 * pretty-print it mid-stream — partial JSON is too fragile. Instead the
 * user sees the live "code being typed" effect which solves the "feels
 * frozen" problem; the final diff lands in ChatPanel's developer-output
 * card once developer.completed fires (this component hides itself then).
 *
 * Mounted near the top of the canvas page alongside <TriageClarificationsLive>.
 */
import * as React from "react";
import { useDeveloperStream } from "@/lib/canvas/useDeveloperStream";

export function DeveloperStreamLive() {
  const stream = useDeveloperStream();
  const preRef = React.useRef<HTMLPreElement | null>(null);

  // Auto-scroll the preview to the bottom as new chunks arrive so the
  // most recent text is always visible. Cheap effect — runs on every
  // text change but only touches one DOM node.
  React.useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [stream?.text]);

  if (!stream) return null;

  // Show a clipped tail of the text so very large diffs don't blow up
  // the panel height — we keep the last ~6k characters which comfortably
  // shows the last hundred-or-so lines of the in-flight diff.
  const MAX_CHARS = 6000;
  const display = stream.text.length > MAX_CHARS
    ? `… [${stream.text.length - MAX_CHARS} earlier chars elided]\n${stream.text.slice(-MAX_CHARS)}`
    : stream.text;
  const charCount = stream.text.length;

  return (
    <div
      data-testid="developer-stream-live"
      className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 p-3"
    >
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-indigo-900">Developer writing code…</span>
        <span className="font-mono text-indigo-700">{charCount.toLocaleString()} chars</span>
      </div>
      <pre
        ref={preRef}
        className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-indigo-100 bg-white p-2 font-mono text-[10px] text-slate-800"
      >
        {display}
      </pre>
    </div>
  );
}
