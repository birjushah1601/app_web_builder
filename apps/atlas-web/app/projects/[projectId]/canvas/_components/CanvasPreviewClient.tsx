"use client";

import { useState } from "react";
import { HmrIframe } from "./HmrIframe";
import { VIEWPORTS } from "./ViewportToggle";
import { ShareableUrlModal } from "./ShareableUrlModal";
import { CanvasPreviewToolbar, type ViewportId } from "./CanvasPreviewToolbar";

interface CanvasPreviewClientProps {
  projectId: string;
  sandboxId: string;
  previewUrl: string | undefined;
  /** Reason the sandbox provision failed, if any. Drives the error panel. */
  previewError?: string;
}

export function CanvasPreviewClient({ projectId, sandboxId, previewUrl, previewError }: CanvasPreviewClientProps) {
  const [viewport, setViewport] = useState<ViewportId>("desktop");
  const [shareOpen, setShareOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
          <div
            data-testid="canvas-preview-frame"
            className="rounded-md border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col transition-all duration-200"
            style={{
              width: VIEWPORTS[viewport].width,
              maxWidth: "100%",
              height: VIEWPORTS[viewport].height,
              maxHeight: "100%"
            }}
          >
            <HmrIframe key={reloadKey} src={previewUrl} title="Live preview" projectId={projectId} />
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
