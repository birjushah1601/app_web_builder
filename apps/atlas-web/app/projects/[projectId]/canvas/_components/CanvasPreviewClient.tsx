"use client";

import { useState } from "react";
import { HmrIframe } from "./HmrIframe";
import { ViewportToggle, type ViewportId, VIEWPORTS } from "./ViewportToggle";
import { ShareableUrlModal } from "./ShareableUrlModal";

interface CanvasPreviewClientProps {
  projectId: string;
  sandboxId: string;
  previewUrl: string | undefined;
}

export function CanvasPreviewClient({ projectId, sandboxId, previewUrl }: CanvasPreviewClientProps) {
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
        <HmrIframe src={previewUrl} title="Live preview" />
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
