"use client";

import React from "react";
import Link from "next/link";
import { startRitual } from "@/lib/actions/startRitual";
import { ChatPanel } from "@/components/ChatPanel";
import { RAIL_SHELL_CONFIG } from "./rail-config";
import { RitualTimelineSlot } from "./ritual-timeline-slot";

interface RailShellProps {
  projectId: string;
}

export function RailShell({ projectId }: RailShellProps): React.ReactElement {
  const cfg = RAIL_SHELL_CONFIG;
  return (
    <aside
      data-testid="rail-shell"
      data-rail-width-px={String(cfg.widthPx)}
      style={{ width: `${cfg.widthPx}px` }}
      className="flex h-full flex-none flex-col border-r border-slate-200 bg-white"
    >
      <header
        role="banner"
        className="flex flex-col gap-1 border-b border-slate-200 px-3 py-2"
      >
        <Link
          href="/projects"
          className="text-xs text-slate-500 hover:text-slate-700 hover:underline"
        >
          ← All projects
        </Link>
        <div className="font-mono text-sm text-slate-900" title={projectId}>
          {projectId}
        </div>
      </header>
      <div className="flex flex-1 min-h-0 flex-col">
        <ChatPanel projectId={projectId} action={startRitual} />
      </div>
      <footer className="border-t border-slate-200 p-2">
        <RitualTimelineSlot projectId={projectId} />
      </footer>
    </aside>
  );
}
