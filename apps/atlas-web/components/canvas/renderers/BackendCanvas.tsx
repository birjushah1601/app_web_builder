"use client";

import type { BackendArtifact } from "@atlas/workflow-engine";

export interface BackendCanvasProps {
  artifact?: BackendArtifact;
  previewUrl?: string;
}

export function BackendCanvas({ artifact, previewUrl }: BackendCanvasProps) {
  const firstRoute = artifact?.routes[0];

  const onCopyCurl = async () => {
    if (!firstRoute || !previewUrl) return;
    const cmd = `curl -X ${firstRoute.method.toUpperCase()} ${previewUrl}${firstRoute.path}`;
    try {
      await navigator.clipboard.writeText(cmd);
    } catch {
      // best-effort; ignore
    }
  };

  if (!previewUrl) {
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
        <span className="font-mono text-slate-700">{previewUrl}</span>
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
        src={`${previewUrl}/docs`}
        className="h-full w-full border-0"
        title="Swagger UI"
      />
    </div>
  );
}
