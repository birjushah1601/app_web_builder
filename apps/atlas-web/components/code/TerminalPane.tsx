"use client";

import React, { useEffect, useRef, useState } from "react";
import { connectTerminal } from "../../lib/actions/code/connectTerminal.js";

export interface TerminalPaneProps {
  projectId: string;
}

/**
 * Client Component. Mounts xterm.js in the DOM ref.
 * In E.3 the backend stub returns a "not connected" message.
 * Plan E.4 replaces the stub with a real WebSocket URL.
 */
export function TerminalPane({ projectId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      if (containerRef.current) {
        terminal.open(containerRef.current);
        fitAddon.fit();
      }

      // Connect to backend (stub in E.3)
      const result = await connectTerminal({ projectId });
      if (result.status === "stub") {
        terminal.write(`\r\n\x1b[33m${result.message}\x1b[0m\r\n`);
        setStatusMessage(result.message);
      }
      // TODO(E.4): result.status === "connected" → establish WebSocket and pipe to terminal
    }

    init();

    return () => {
      terminal?.dispose();
    };
  }, [projectId]);

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
