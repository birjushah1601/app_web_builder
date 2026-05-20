"use client";

import React from "react";

interface Props {
  status: string;
}

/** Vercel-style dotted-grid backdrop for the preview zone before the iframe
 *  has anything to render. Kept simple — a CSS background-image of a tiny
 *  radial gradient repeated on a 16px grid. */
export function EmptyPreviewBackdrop({ status }: Props) {
  return (
    <div
      data-testid="empty-preview-backdrop"
      role="status"
      aria-live="polite"
      className="flex h-full w-full items-center justify-center text-xs font-mono text-slate-500"
      style={{
        backgroundImage: "radial-gradient(circle, rgba(15,23,42,0.12) 1px, transparent 1px)",
        backgroundSize: "16px 16px",
        backgroundColor: "#fafafa"
      }}
    >
      <span className="rounded-md border border-slate-200 bg-white/70 px-3 py-1 backdrop-blur-sm">
        {status}
      </span>
    </div>
  );
}
