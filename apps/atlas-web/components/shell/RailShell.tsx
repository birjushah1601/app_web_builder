"use client";

import React from "react";
import Link from "next/link";
import { startRitual } from "@/lib/actions/startRitual";
import { refineRitual } from "@/lib/actions/refineRitual";
import { ChatPanel } from "@/components/ChatPanel";
import { RAIL_SHELL_CONFIG } from "./rail-config";
import { RitualTimelineSlot } from "./ritual-timeline-slot";

interface RailShellProps {
  projectId: string;
  /** Plan K: server-evaluated flag passed in by the [projectId]/layout. When
   *  true, ChatPanel renders <RefinementInputBar /> beneath developer outputs. */
  multiTurnFlagEnabled?: boolean;
  /** Refine-by-default: server-resolved latest ritualId so the main input
   *  box auto-routes the next submit through refineAction. Forwarded to
   *  ChatPanel. */
  initialLatestRitualId?: string;
  /** Plan UXO Task 6: server-evaluated reference-input flag forwarded to
   *  ChatPanel so it mounts a ReferenceDropZone above the textarea. */
  referenceInputEnabled?: boolean;
  /** Plan UXO Task 7: server-evaluated editable-plan flag forwarded to
   *  the embedded RitualTimelineSlot. */
  editablePlanEnabled?: boolean;
}

export function RailShell({ projectId, multiTurnFlagEnabled = false, initialLatestRitualId, referenceInputEnabled = false, editablePlanEnabled = false }: RailShellProps): React.ReactElement {
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
      <section
        aria-label="Live progress"
        className="border-b border-slate-200 p-2"
      >
        <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Live progress
        </div>
        <RitualTimelineSlot projectId={projectId} editablePlanEnabled={editablePlanEnabled} />
      </section>
      <div className="flex flex-1 min-h-0 flex-col">
        <ChatPanel
          projectId={projectId}
          action={startRitual}
          multiTurnFlagEnabled={multiTurnFlagEnabled}
          refineAction={refineRitual}
          referenceInputEnabled={referenceInputEnabled}
          {...(initialLatestRitualId !== undefined ? { initialLatestRitualId } : {})}
        />
      </div>
    </aside>
  );
}
