"use client";
import * as React from "react";
import type { DomNode } from "@/lib/canvas/use-element-selection";

export interface FloatingToolbarProps {
  node: DomNode;
  onEditText: (node: DomNode) => void;
  onOpenStyle: (node: DomNode) => void;
  onAskAi: (node: DomNode) => void;
  onReplaceImage?: (node: DomNode) => void;
}

/** Action toolbar anchored above (or below if near viewport top) the
 *  currently-selected DOM element. Renders different button sets per
 *  element type — text elements show Edit text / Style / Ask AI; images
 *  show Replace image / Style / Ask AI. */
export function FloatingToolbar({
  node,
  onEditText,
  onOpenStyle,
  onAskAi,
  onReplaceImage
}: FloatingToolbarProps) {
  const isImage = node.tag === "img";
  const isText = !isImage; // simplified: anything non-img is text-capable
  // Anchor 36px above the element, clamped to viewport.
  const top = Math.max(8, node.rect.y - 36);
  const left = Math.max(8, node.rect.x);

  return (
    <div
      data-testid="floating-toolbar"
      role="toolbar"
      aria-label="Element actions"
      className="pointer-events-auto absolute z-50 flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1 py-1 text-xs shadow-md"
      style={{ top, left }}
    >
      {isText && (
        <button
          type="button"
          onClick={() => onEditText(node)}
          className="rounded px-2 py-1 hover:bg-slate-100"
        >
          ✎ Edit text
        </button>
      )}
      {isImage && onReplaceImage && (
        <button
          type="button"
          onClick={() => onReplaceImage(node)}
          className="rounded px-2 py-1 hover:bg-slate-100"
        >
          🖼 Replace image
        </button>
      )}
      <button
        type="button"
        onClick={() => onOpenStyle(node)}
        className="rounded px-2 py-1 hover:bg-slate-100"
      >
        🎨 Style
      </button>
      <button
        type="button"
        onClick={() => onAskAi(node)}
        className="rounded px-2 py-1 hover:bg-slate-100"
      >
        ✨ Ask AI
      </button>
    </div>
  );
}
