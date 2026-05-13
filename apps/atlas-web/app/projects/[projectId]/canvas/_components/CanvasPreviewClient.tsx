"use client";

import * as React from "react";
import { useRef, useState } from "react";
import { HmrIframe } from "./HmrIframe";
import { VIEWPORTS } from "./ViewportToggle";
import { ShareableUrlModal } from "./ShareableUrlModal";
import { CanvasPreviewToolbar, type ViewportId } from "./CanvasPreviewToolbar";
import { IframeOverlay } from "@/components/canvas/IframeOverlay";
import { ElementInspector } from "@/components/canvas/ElementInspector";
import { FloatingToolbar } from "@/components/canvas/FloatingToolbar";
import { ImageReplacePopover } from "@/components/canvas/ImageReplacePopover";
import { ElementContextMenu } from "@/components/canvas/ElementContextMenu";
import type { DomMutationOp } from "@atlas/edit-patch-engine";
import { bridgeMakeEditable, bridgeReplaceImg, bridgeRevertText } from "@/lib/canvas/atlas-edit-bridge-client";
import { useEditPatchQueue } from "@/lib/canvas/use-edit-patch-queue";
import { applyPatch as applyPatchAction } from "@/lib/actions/applyPatch";
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
  /**
   * Plan canvas-in-place-editing Task 17 — when true, mount <FloatingToolbar />
   * anchored to the selected element and wire text/image patch flows.
   * Resolved server-side so this client component stays env-free.
   */
  inlineEditEnabled?: boolean;
}

export function CanvasPreviewClient({
  projectId,
  sandboxId,
  previewUrl,
  previewError,
  clickToEditEnabled,
  elementSlidersEnabled,
  inlineEditEnabled
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

  // Phase 1 simplification: every patch targets page.tsx. Phase 2 will derive
  // the target file from the selected element's source location.
  const TARGET_FILE = "/code/src/app/page.tsx";

  const [imagePopoverOpen, setImagePopoverOpen] = React.useState(false);
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);

  const queue = useEditPatchQueue({
    apply: async (req) => {
      const result = await applyPatchAction({
        projectId,
        filePath: req.filePath,
        patch: req.patch
      });
      return {
        ok: result.ok,
        ...(result.inverse !== undefined ? { inverse: result.inverse } : {}),
        ...(result.error !== undefined ? { error: result.error } : {})
      };
    }
  });

  const handleEditText = React.useCallback((node: DomNode) => {
    if (!overlayIframeRef.current || !node.atlasId) return;
    bridgeMakeEditable(overlayIframeRef.current, { atlasId: node.atlasId });
  }, []);

  const handleReplaceImage = React.useCallback((_node: DomNode) => {
    setImagePopoverOpen(true);
  }, []);

  const handleContextMenu = React.useCallback((e: React.MouseEvent) => {
    if (!selected || !inlineEditEnabled) return;
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [selected, inlineEditEnabled]);

  const handleContextAction = React.useCallback(async (op: DomMutationOp) => {
    setContextMenu(null);
    if (!selected?.atlasId) return;
    await queue.submitPatch({
      filePath: TARGET_FILE,
      patch: { kind: "dom-mutation", atlasId: selected.atlasId, op }
    });
  }, [selected, queue]);

  const handleAskAi = React.useCallback((node: DomNode) => {
    if (!node.atlasId) return;
    const labelText = (node.text ?? "").slice(0, 24);
    const label = `<${node.tag}>${labelText}${labelText.length === 24 ? "…" : ""}</${node.tag}>`;
    window.dispatchEvent(
      new CustomEvent("atlas:set-chat-selection", {
        detail: { label, atlasId: node.atlasId, filePath: TARGET_FILE }
      })
    );
  }, []);

  // Keyboard shortcuts: Cmd/Ctrl+Z → undo, Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y → redo.
  // Only fires when inlineEditEnabled is true and the target is NOT a text input,
  // so the browser's native per-character undo still works inside contenteditable.
  React.useEffect(() => {
    if (!inlineEditEnabled) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        void queue.undo();
      } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        e.preventDefault();
        void queue.redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inlineEditEnabled, queue]);

  // Listen for atlas-text-committed messages from the bridge → submit text-replace patch.
  React.useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data as { type?: string; atlasId?: string; newText?: string };
      if (data?.type !== "atlas-text-committed" || !data.atlasId) return;
      const oldText = selected?.text ?? "";
      const newText = data.newText ?? "";
      if (oldText === newText) return;
      const atlasId = data.atlasId;
      void queue
        .submitPatch({
          filePath: TARGET_FILE,
          patch: { kind: "text-replace", atlasId, oldText, newText }
        })
        .then((result) => {
          if (!result.ok && overlayIframeRef.current) {
            bridgeRevertText(overlayIframeRef.current, { atlasId, oldText });
          }
        });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [selected, queue]);

  // Click-to-edit overlay is gated on BOTH the feature flag (server-resolved
  // and threaded down as a prop) AND the workspace mode being "visual-edits".
  // useCanvasMode is the same hook ModeToolbarHost writes to, so the toolbar
  // and the overlay stay in sync without prop-drilling the mode through every
  // canvas-shell descendant.
  const { mode } = useCanvasMode(projectId);
  const overlayActive = clickToEditEnabled === true && mode === "visual-edits";
  // Plan UXO Task 8 — element inspector panel. Triple gate: server-resolved
  // flag AND visual-edits mode AND a selected element to inspect. Without
  // the third clause, the panel sat empty showing "Click a node to inspect"
  // and just wasted ~256px of canvas width — surface it only when there's
  // actually something to render, so the iframe gets the full width by
  // default and the panel slides in when the user clicks an element.
  const inspectorActive = elementSlidersEnabled === true && mode === "visual-edits" && selected !== null;

  return (
    <div className="flex flex-col h-full">
      <CanvasPreviewToolbar
        viewport={viewport}
        onViewportChange={setViewport}
        previewUrl={previewUrl}
        onReload={() => setReloadKey((k) => k + 1)}
        onShare={() => setShareOpen(true)}
      />
      <div className="flex-1 min-h-0 overflow-auto flex items-start justify-center bg-slate-50 p-1">
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
          <div className="flex flex-row items-stretch gap-2 max-w-full w-full h-full">
            <div
              data-testid="canvas-preview-frame"
              className="relative rounded-md border border-slate-200 bg-white shadow-sm overflow-auto flex flex-col transition-all duration-200"
              onContextMenu={handleContextMenu}
              style={{
                // Desktop viewport: fill the available pane so a 4000px-tall
                // landing page can scroll internally instead of being clipped
                // by the 900px nominal "desktop" height. Tablet + mobile keep
                // the device-frame width but stretch to pane height for the
                // same reason.
                width: viewport === "desktop" ? "100%" : VIEWPORTS[viewport].width,
                maxWidth: "100%",
                height: "100%",
                minHeight: 0
              }}
            >
              <HmrIframe key={reloadKey} src={previewUrl} title="Live preview" projectId={projectId} />
              {overlayActive && (
                <IframeOverlay
                  iframeRef={overlayIframeRef}
                  onSelect={setSelected}
                />
              )}
              {inlineEditEnabled && selected && (
                <FloatingToolbar
                  node={selected}
                  onEditText={handleEditText}
                  onOpenStyle={() => {/* Phase 1 stub — wire to ElementInspector popover later */}}
                  onAskAi={handleAskAi}
                  onReplaceImage={handleReplaceImage}
                />
              )}
              {inlineEditEnabled && contextMenu !== null && (
                <ElementContextMenu
                  x={contextMenu.x}
                  y={contextMenu.y}
                  onAction={handleContextAction}
                  onClose={() => setContextMenu(null)}
                />
              )}
              {inlineEditEnabled && (queue.canUndo || queue.canRedo) && (
                <div className="absolute top-2 right-2 z-40 flex gap-1 rounded-md border border-slate-200 bg-white/95 px-1 py-1 text-xs shadow-sm">
                  <button
                    type="button"
                    disabled={!queue.canUndo}
                    onClick={() => void queue.undo()}
                    title="Undo (Cmd/Ctrl+Z)"
                    className="rounded px-2 py-0.5 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    ↶ Undo
                  </button>
                  <button
                    type="button"
                    disabled={!queue.canRedo}
                    onClick={() => void queue.redo()}
                    title="Redo (Cmd/Ctrl+Shift+Z)"
                    className="rounded px-2 py-0.5 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    ↷ Redo
                  </button>
                </div>
              )}
              {inlineEditEnabled && imagePopoverOpen && selected && (
                <ImageReplacePopover
                  onClose={() => setImagePopoverOpen(false)}
                  onSubmit={async ({ url, alt }) => {
                    setImagePopoverOpen(false);
                    if (!selected.atlasId) return;
                    const atlasId = selected.atlasId;
                    const oldUrl = "";
                    if (overlayIframeRef.current) {
                      bridgeReplaceImg(overlayIframeRef.current, {
                        atlasId,
                        newUrl: url,
                        ...(alt !== undefined ? { newAlt: alt } : {})
                      });
                    }
                    await queue.submitPatch({
                      filePath: TARGET_FILE,
                      patch: {
                        kind: "asset-swap",
                        atlasId,
                        oldUrl,
                        newUrl: url,
                        ...(alt !== undefined ? { newAlt: alt } : {})
                      }
                    });
                  }}
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
