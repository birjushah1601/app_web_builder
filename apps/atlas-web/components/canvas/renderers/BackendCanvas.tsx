"use client";

import type { BackendArtifact } from "@atlas/workflow-engine";

export interface BackendCanvasProps {
  artifact?: BackendArtifact;
  /** Frontend dev-server URL — set by PreviewCanvas's wiring. The backend
   *  canvas uses it only as a fallback. */
  previewUrl?: string;
  /** Plan D fix #2 — backend sandbox URL, set by the workflow drill-in
   *  page. Preferred over `previewUrl` (the frontend dev-server URL)
   *  because the two are semantically distinct sandboxes. */
  backendPreviewUrl?: string;
}

export function BackendCanvas({ artifact, previewUrl, backendPreviewUrl }: BackendCanvasProps) {
  const effectivePreviewUrl = backendPreviewUrl ?? artifact?.previewUrl ?? previewUrl;
  const firstRoute = artifact?.routes[0];

  const onCopyCurl = async () => {
    if (!firstRoute || !effectivePreviewUrl) return;
    const cmd = `curl -X ${firstRoute.method.toUpperCase()} ${effectivePreviewUrl}${firstRoute.path}`;
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      // best-effort; ignore
    }
  };

  if (!effectivePreviewUrl) {
    return (
      <div
        data-testid="backend-canvas-no-preview"
        className="flex h-full w-full items-center justify-center bg-slate-50 p-8 text-sm text-slate-700"
      >
        Backend preview URL not yet available. Waiting for the ritual to provision the sandbox…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs">
        <span className="font-mono text-slate-700">{effectivePreviewUrl}</span>
        <button
          type="button"
          data-testid="backend-copy-curl"
          onClick={onCopyCurl}
          disabled={!firstRoute}
          className="ml-auto rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
        >
          Copy curl example
        </button>
      </header>
      <iframe
        data-testid="backend-swagger-iframe"
        src={`${effectivePreviewUrl}/docs`}
        className="h-full w-full border-0"
        title="Swagger UI"
      />
    </div>
  );
}
