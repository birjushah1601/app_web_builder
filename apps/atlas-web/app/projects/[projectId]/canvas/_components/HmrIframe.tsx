"use client";

import { useEffect, useMemo, useRef } from "react";
import { useReloadOnApplied, RELOAD_PARAM } from "@/lib/canvas/useReloadOnApplied";

interface HmrIframeProps {
  src: string | undefined;
  title: string;
  /** Project id used to scope the SSE subscription via Plan E.0's
   *  EventSourceProvider context. The provider itself is mounted by a
   *  parent (Plan G's RailShell, or a temporary host until Plan G ships);
   *  this component just consumes the context. */
  projectId: string;
  onLoad?: () => void;
  className?: string;
}

export function HmrIframe({ src, title, projectId, onLoad, className }: HmrIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { cacheBuster, toast, manualReload } = useReloadOnApplied(projectId);

  // Compute the effective src — append `?atlas-reload=<value>` (or `&...`
  // when the URL already has a query string) once cacheBuster is non-empty.
  // While cacheBuster === "" (no reload has been triggered yet), the iframe
  // uses the bare previewUrl so the first paint is identical to today's
  // pre-Plan-F behaviour.
  const effectiveSrc = useMemo(() => {
    if (!src) return undefined;
    if (cacheBuster === "") return src;
    const sep = src.includes("?") ? "&" : "?";
    return `${src}${sep}${RELOAD_PARAM}=${encodeURIComponent(cacheBuster)}`;
  }, [src, cacheBuster]);

  useEffect(() => {
    if (!iframeRef.current || !effectiveSrc) return;
    // Dynamically import iframe-resizer to avoid SSR issues
    import("iframe-resizer").then(({ iframeResize }) => {
      if (iframeRef.current) {
        iframeResize({ log: false, checkOrigin: false }, iframeRef.current);
      }
    });
  }, [effectiveSrc]);

  if (!src) {
    return (
      <div
        data-testid="hmr-iframe-skeleton"
        className="animate-pulse bg-muted rounded-lg w-full h-full min-h-[400px]"
        aria-label="Sandbox preview loading"
      />
    );
  }

  return (
    <div className="relative flex flex-col h-full">
      {toast !== null && (
        <div
          role="alert"
          data-testid="preview-reload-toast"
          className="m-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {toast}
        </div>
      )}
      <div className="flex justify-end px-2 py-1">
        <button
          type="button"
          data-testid="preview-reload-button"
          onClick={manualReload}
          className="rounded px-3 py-1 text-sm font-medium border text-muted-foreground hover:bg-muted"
        >
          Reload preview
        </button>
      </div>
      <iframe
        ref={iframeRef}
        src={effectiveSrc}
        title={title}
        onLoad={onLoad}
        className={className ?? "w-full h-full border-0 rounded-lg flex-1"}
        allow="clipboard-read; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
