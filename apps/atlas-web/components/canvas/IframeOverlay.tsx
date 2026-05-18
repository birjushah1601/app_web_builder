"use client";
/**
 * Plan UXO change 3 — click-to-edit overlay.
 *
 * Renders one absolutely-positioned hit-zone per editable DOM node sent
 * by the sandbox's atlas-edit-bridge (via window.postMessage). Hover
 * paints a blue ring; click paints a green ring and fires onSelect so a
 * downstream Visual Edits panel can offer Haiku-proposed slider axes,
 * className edits, etc.
 *
 * Mounted by <CanvasPreviewClient /> behind the `click-to-edit`
 * (ATLAS_FF_CLICK_TO_EDIT) feature flag AND only when the canvas mode is
 * "visual-edits". The parent container must be `position: relative` so
 * the overlay's `inset-0` covers the iframe exactly.
 *
 * iframeRef is unused today (the overlay coordinates come pre-translated
 * from inside the sandbox), but accepted so future passes can scroll the
 * iframe to keep a selected element in view without changing the API.
 */
import * as React from "react";
import { useElementSelection, type DomNode } from "@/lib/canvas/use-element-selection";

export interface IframeOverlayProps {
  iframeRef: React.RefObject<HTMLIFrameElement>;
  onSelect: (n: DomNode) => void;
}

export function IframeOverlay({ iframeRef: _iframeRef, onSelect }: IframeOverlayProps) {
  const { nodes, selected, setSelected } = useElementSelection();
  const [hover, setHover] = React.useState<DomNode | null>(null);
  return (
    <div data-testid="iframe-overlay" className="pointer-events-none absolute inset-0">
      {nodes.map((n) => {
        const isSelected = selected?.selector === n.selector;
        const isHover = hover?.selector === n.selector;
        const ring = isSelected
          ? "ring-2 ring-emerald-500"
          : isHover
            ? "ring-1 ring-blue-400"
            : "ring-0";
        return (
          <div
            key={n.selector}
            data-testid="iframe-overlay-hit-zone"
            data-selector={n.selector}
            className={`absolute pointer-events-auto ${ring}`}
            style={{
              left: n.rect.x,
              top: n.rect.y,
              width: n.rect.width,
              height: n.rect.height
            }}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover((cur) => (cur === n ? null : cur))}
            onClick={(e) => {
              e.stopPropagation();
              setSelected(n);
              onSelect(n);
            }}
          />
        );
      })}
    </div>
  );
}
