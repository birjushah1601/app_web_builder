"use client";

import { useState } from "react";
import { HmrIframe } from "./HmrIframe";
import { ViewportToggle, type ViewportId, VIEWPORTS } from "./ViewportToggle";
import { ShareableUrlModal } from "./ShareableUrlModal";

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <ViewportToggle viewport={viewport} onViewportChange={setViewport} />
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="rounded px-3 py-1.5 text-sm border hover:bg-muted"
        >
          Share
        </button>
      </div>
      <div
        className="flex-1 overflow-auto flex justify-center"
        style={{ maxWidth: VIEWPORTS[viewport].width }}
      >
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
          <HmrIframe src={previewUrl} title="Live preview" />
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
