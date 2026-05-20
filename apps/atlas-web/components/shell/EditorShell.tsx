"use client";

import React from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { useEditorLayoutPersistence, DEFAULT_LAYOUT } from "@/lib/editor-layout/use-editor-layout-persistence";

interface Props {
  projectId: string;
  left: React.ReactNode;
  right: React.ReactNode;
}

export function EditorShell({ projectId, left, right }: Props) {
  const { layout, setLayout } = useEditorLayoutPersistence(projectId);

  const onLayout = (sizes: number[]) => {
    if (sizes.length !== 2) return;
    const newLeft = Math.round(sizes[0]!);
    if (newLeft !== layout.leftWidthPct && !layout.leftCollapsed && !layout.rightCollapsed) {
      setLayout({ ...layout, leftWidthPct: newLeft });
    }
  };

  return (
    <div
      data-testid="editor-shell"
      data-default-left-pct={String(DEFAULT_LAYOUT.leftWidthPct)}
      data-current-left-pct={String(layout.leftWidthPct)}
      data-left-collapsed={String(layout.leftCollapsed)}
      data-right-collapsed={String(layout.rightCollapsed)}
      className="flex h-full w-full"
    >
      {/* Collapse rails are only shown when their panel IS collapsed —
       *  otherwise the resize handle in the middle is the only divider, and
       *  the user reclaims the previously-wasted 12px per side. When a panel
       *  is collapsed, the rail is the only way back, so we keep it visible
       *  in that state. */}
      {layout.leftCollapsed && (
        <button
          type="button"
          data-testid="editor-shell-collapse-left"
          aria-label="Expand chat panel"
          onClick={() => setLayout({ ...layout, leftCollapsed: false })}
          className="flex w-3 items-center justify-center border-r border-slate-200 bg-slate-50 text-[10px] text-slate-400 hover:text-slate-900"
        >
          ›
        </button>
      )}

      {layout.leftCollapsed ? (
        <main className="flex-1 min-w-0 overflow-auto">{right}</main>
      ) : layout.rightCollapsed ? (
        // When right is collapsed, give the left (chat) the full remaining
        // width by wrapping it in a flex container that overrides the
        // RailShell's intrinsic 360px so the chat actually fills the screen.
        <div className="flex flex-1 min-w-0 overflow-auto [&>aside]:!w-full [&>aside]:!flex-1">
          {left}
        </div>
      ) : (
        <PanelGroup direction="horizontal" onLayout={onLayout} className="flex flex-1 min-w-0">
          <Panel defaultSize={layout.leftWidthPct} minSize={15} maxSize={85} className="flex flex-col min-w-0">
            {left}
          </Panel>
          <PanelResizeHandle
            data-testid="editor-shell-handle"
            className="w-px bg-slate-200 hover:bg-slate-400 active:bg-slate-500 transition-colors cursor-col-resize"
          />
          <Panel defaultSize={100 - layout.leftWidthPct} minSize={15} maxSize={85} className="flex flex-col min-w-0">
            {right}
          </Panel>
        </PanelGroup>
      )}

      {layout.rightCollapsed && (
        <button
          type="button"
          data-testid="editor-shell-collapse-right"
          aria-label="Expand preview panel"
          onClick={() => setLayout({ ...layout, rightCollapsed: false })}
          className="flex w-3 items-center justify-center border-l border-slate-200 bg-slate-50 text-[10px] text-slate-400 hover:text-slate-900"
        >
          ‹
        </button>
      )}
    </div>
  );
}
