"use client";

import { useRef, useState } from "react";
import { HmrIframe } from "./HmrIframe";
import { VIEWPORTS } from "./ViewportToggle";
import { ShareableUrlModal } from "./ShareableUrlModal";
import { CanvasPreviewToolbar, type ViewportId } from "./CanvasPreviewToolbar";
import { IframeOverlay } from "@/components/canvas/IframeOverlay";
import { ElementInspector } from "@/components/canvas/ElementInspector";
import { useCanvasMode } from "@/lib/canvas/use-canvas-state";
import type { DomNode } from "@/lib/canvas/use-element-selection";

interface CanvasPreviewClientProps {
  projectId: string;
  sandboxId: string;
  previewUrl: string | undefined;
  /** Reason the sandbox provision failed, if any. Drives the error panel. */
  previewError?: string;
  /**
   * Plan UXO change 3 — when true, mount <IframeOverlay /> over the
   * preview iframe (only while the workspace mode is "visual-edits").
   * Read from the `click-to-edit` (ATLAS_FF_CLICK_TO_EDIT) feature flag
   * by the server page and threaded down as a boolean so this client
   * component does not need to consult process.env at render time.
   */
  clickToEditEnabled?: boolean;
  /**
   * Plan UXO Task 8 / change 6 — when true, mount <ElementInspector /> as
   * a side panel alongside the preview iframe (only while the workspace
   * mode is "visual-edits"). Read from the `element-sliders`
   * (ATLAS_FF_ELEMENT_SLIDERS) flag by the server page and threaded down
   * so this client component does not need to consult process.env.
   *
   * Selection is lifted to this component so the IframeOverlay (writer)
   * and the inspector (reader) share one DomNode. `useElementSelection`
   * is per-consumer (each hook instance has its own state), so without
   * lifting, the inspector would never see the clicked element.
   */
  elementSlidersEnabled?: boolean;
}

export function CanvasPreviewClient({
  projectId,
  sandboxId,
  previewUrl,
  previewError,
  clickToEditEnabled,
  elementSlidersEnabled
}: CanvasPreviewClientProps) {
  const [viewport, setViewport] = useState<ViewportId>("desktop");
  const [shareOpen, setShareOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Held so we can hand a stable ref to <IframeOverlay /> — the overlay
  // does not read it today (coordinates come pre-translated from inside
  // the sandbox) but keeps the API door open for future scroll-into-view
  // / scroll-sync behavior without a breaking change.
  const overlayIframeRef = useRef<HTMLIFrameElement>(null);
  // Lifted selection — IframeOverlay writes via onSelect, ElementInspector
  // reads via the `selected` prop. useElementSelection is per-consumer (each
  // hook instance owns its own state), so without lifting here, the inspector
  // would never observe the overlay's clicked element.
  const [selected, setSelected] = useState<DomNode | null>(null);

  // Click-to-edit overlay is gated on BOTH the feature flag (server-resolved
  // and threaded down as a prop) AND the workspace mode being "visual-edits".
  // useCanvasMode is the same hook ModeToolbarHost writes to, so the toolbar
  // and the overlay stay in sync without prop-drilling the mode through every
  // canvas-shell descendant.
  const { mode } = useCanvasMode(projectId);
  const overlayActive = clickToEditEnabled === true && mode === "visual-edits";
  // Plan UXO Task 8 — element inspector panel. Same dual gate as the overlay:
  // server-resolved flag AND visual-edits mode. When OFF, the side panel
  // collapses out so the iframe regains its full width (today's behavior).
  const inspectorActive = elementSlidersEnabled === true && mode === "visual-edits";

  return (
    <div className="flex flex-col h-full">
      <CanvasPreviewToolbar
        viewport={viewport}
        onViewportChange={setViewport}
        previewUrl={previewUrl}
        onReload={() => setReloadKey((k) => k + 1)}
        onShare={() => setShareOpen(true)}
      />
      <div className="flex-1 overflow-auto flex items-start justify-center bg-slate-50 p-4">
        {previewError ? (
          <div
            role="alert"
            data-testid="canvas-preview-error"
            className="m-4 max-w-md self-start rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            <strong className="mb-1 block">Preview unavailable</strong>
            <span className="block break-words">{previewError}</span>
            <span className="mt-2 block text-xs text-red-500">
              Refresh once the cause (spend cap, API key, sandbox quota…) is resolved.
            </span>
          </div>
        ) : (
          <div className="flex flex-row items-start gap-4 max-w-full">
            <div
              data-testid="canvas-preview-frame"
              className="relative rounded-md border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col transition-all duration-200"
              style={{
                width: VIEWPORTS[viewport].width,
                maxWidth: "100%",
                height: VIEWPORTS[viewport].height,
                maxHeight: "100%"
              }}
            >
              <HmrIframe key={reloadKey} src={previewUrl} title="Live preview" projectId={projectId} />
              {overlayActive && (
                <IframeOverlay
                  iframeRef={overlayIframeRef}
                  onSelect={setSelected}
                />
              )}
            </div>
            {inspectorActive && (
              <aside
                data-testid="element-inspector-pane"
                className="w-64 shrink-0 rounded-md border border-slate-200 bg-white shadow-sm"
              >
                <ElementInspector projectId={projectId} selected={selected} />
              </aside>
            )}
          </div>
        )}
      </div>
      <ShareableUrlModal
        projectId={projectId}
        sandboxId={sandboxId}
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}
