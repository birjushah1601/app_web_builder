"use client";

import React, { useCallback, useRef, useState } from "react";
import { runTerminalCommand } from "../../lib/actions/code/runTerminalCommand";

export interface TerminalPaneProps {
  projectId: string;
}

interface LastResult {
  exitCode: number;
}

/**
 * Minimal terminal UI: one input, one scrollback `<pre>`. Submit a command,
 * await a single structured `{stdout, stderr, exitCode}` response from the
 * `runTerminalCommand` Server Action, and append a formatted block to
 * scrollback. No xterm.js, no WebSocket, no streaming — by design.
 *
 * The exit-code badge is green on 0 and red otherwise; it reflects the most
 * recent command only.
 */
export function TerminalPane({ projectId }: TerminalPaneProps) {
  const [input, setInput] = useState("");
  const [scrollback, setScrollback] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<LastResult | null>(null);
  const scrollRef = useRef<HTMLPreElement>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const command = input.trim();
      if (!command || busy) return;
      setBusy(true);
      setInput("");
      try {
        const result = await runTerminalCommand({ projectId, command });
        const block = `$ ${command}\n${result.stdout}${result.stderr}`;
        setScrollback((prev) => (prev ? `${prev}\n${block}` : block));
        setLast({ exitCode: result.exitCode });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const block = `$ ${command}\n${message}`;
        setScrollback((prev) => (prev ? `${prev}\n${block}` : block));
        setLast({ exitCode: 1 });
      } finally {
        setBusy(false);
        // Defer scroll to bottom — let React paint the new content first.
        queueMicrotask(() => {
          const el = scrollRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    },
    [busy, input, projectId]
  );

  const badge = last
    ? {
        label: `exit ${last.exitCode}`,
        className:
          last.exitCode === 0
            ? "bg-emerald-700 text-emerald-50"
            : "bg-red-700 text-red-50"
      }
    : null;

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1">
        <span className="text-xs uppercase tracking-wider text-zinc-500">
          Terminal
        </span>
        {badge && (
          <span
            data-testid="terminal-exit-badge"
            className={`rounded px-2 py-0.5 text-[10px] font-mono ${badge.className}`}
          >
            {badge.label}
          </span>
        )}
      </div>

      <pre
        ref={scrollRef}
        data-testid="terminal-scrollback"
        className="flex-1 overflow-auto whitespace-pre-wrap break-words bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200"
      >
        {scrollback}
      </pre>

      <form
        onSubmit={handleSubmit}
        className="flex border-t border-zinc-800 bg-zinc-900"
      >
        <span className="select-none px-2 py-2 font-mono text-xs text-emerald-400">
          $
        </span>
        <input
          aria-label="Terminal command"
          type="text"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? "running…" : "type a command and press Enter"}
          className="flex-1 bg-transparent py-2 pr-3 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        />
      </form>
    </div>
  );
}
