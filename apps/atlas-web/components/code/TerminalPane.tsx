"use client";

import React, { useEffect, useRef, useState } from "react";
import { connectTerminal } from "../../lib/actions/code/connectTerminal.js";
import type { SandboxExec } from "@atlas/sandbox-e2b";
import type { SandboxId } from "@atlas/sandbox-e2b";

export interface TerminalPaneProps {
  projectId: string;
  /** E.4: When provided, stream sandbox shell output instead of using the E.3 stub. */
  sandboxId?: SandboxId;
  /** E.4: Injected SandboxExec — allows tests to pass a mock without touching the factory. */
  sandboxExec?: Pick<SandboxExec, "streamCommand">;
  /** E.4: Shell command to stream. Defaults to "bash". */
  shellCommand?: string;
}

/**
 * Client Component. Mounts xterm.js in the DOM ref.
 * In E.3 the backend stub returns a "not connected" message.
 * E.4 adds a real sandbox shell via SandboxExec.streamCommand when sandboxId is provided.
 */
export function TerminalPane({ projectId, sandboxId, sandboxExec, shellCommand }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const termRef = useRef<import("xterm").Terminal | null>(null);

  useEffect(() => {
    let terminal: import("xterm").Terminal | null = null;

    async function init() {
      const { Terminal } = await import("xterm");
      const { FitAddon } = await import("xterm-addon-fit");

      terminal = new Terminal({
        theme: { background: "#18181b", foreground: "#d4d4d8" },
        fontSize: 13,
        cursorBlink: true,
      });
      termRef.current = terminal;
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      if (containerRef.current) {
        terminal.open(containerRef.current);
        fitAddon.fit();
      }

      if (!sandboxId || !sandboxExec) {
        // Fallback to E.3 stub behaviour
        const result = await connectTerminal({ projectId });
        if (result.status === "stub") {
          terminal.write(`\r\n\x1b[33m${result.message}\x1b[0m\r\n`);
          setStatusMessage(result.message);
        }
      }
    }

    init();

    return () => {
      terminal?.dispose();
      termRef.current = null;
    };
    // sandboxExec + sandboxId are handled by the separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // E.4: Stream sandbox shell output when sandboxId is provided
  useEffect(() => {
    if (!sandboxId || !sandboxExec) return;
    const term = termRef.current;
    if (!term) return;

    let cancelled = false;

    async function stream() {
      for await (const chunk of sandboxExec!.streamCommand(sandboxId!, shellCommand ?? "bash")) {
        if (cancelled) break;
        termRef.current?.write(chunk.data);
      }
    }
    void stream();
    return () => { cancelled = true; };
  }, [sandboxId, sandboxExec, shellCommand]);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {statusMessage && (
        <div
          data-testid="terminal-status"
          className="border-b border-zinc-800 px-3 py-1 text-xs text-amber-400"
        >
          {statusMessage}
        </div>
      )}
      <div ref={containerRef} className="flex-1 overflow-hidden p-1" />
    </div>
  );
}
