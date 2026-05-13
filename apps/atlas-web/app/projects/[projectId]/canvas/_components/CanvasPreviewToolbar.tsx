"use client";

import React from "react";

export type ViewportId = "desktop" | "tablet" | "mobile";

interface Props {
  viewport: ViewportId;
  onViewportChange: (v: ViewportId) => void;
  previewUrl: string | undefined;
  onReload: () => void;
  /** Optional — when provided, renders a "↗ Share" button between Reload and Open. */
  onShare?: () => void;
}

const OPTIONS: ReadonlyArray<{ id: ViewportId; label: string }> = [
  { id: "desktop", label: "Desktop" },
  { id: "tablet", label: "Tablet" },
  { id: "mobile", label: "Mobile" }
];

export function CanvasPreviewToolbar({ viewport, onViewportChange, previewUrl, onReload, onShare }: Props) {
  return (
    <div
      data-testid="canvas-preview-toolbar"
      className="flex items-center justify-between border-b border-slate-200 px-2 h-6 text-xs font-mono"
    >
      <div role="radiogroup" aria-label="Preview viewport" className="inline-flex rounded-md border border-slate-200 overflow-hidden">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={viewport === opt.id}
            aria-label={opt.label}
            onClick={() => onViewportChange(opt.id)}
            className={`px-2 h-6 ${viewport === opt.id ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="preview-toolbar-reload"
          onClick={onReload}
          aria-label="Reload preview"
          className="rounded border border-slate-200 px-2 h-6 hover:bg-slate-50"
        >
          ↻ Reload
        </button>
        {onShare && (
          <button
            type="button"
            data-testid="preview-toolbar-share"
            onClick={onShare}
            aria-label="Share preview"
            className="rounded border border-slate-200 px-2 h-6 hover:bg-slate-50"
          >
            ↗ Share
          </button>
        )}
        <a
          data-testid="preview-toolbar-open-tab"
          href={previewUrl ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open preview in new tab"
          aria-disabled={!previewUrl}
          className={`rounded border border-slate-200 px-2 h-6 inline-flex items-center hover:bg-slate-50 ${!previewUrl ? "pointer-events-none opacity-50" : ""}`}
        >
          ⤢ Open
        </a>
      </div>
    </div>
  );
}
