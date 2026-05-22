"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useReloadOnApplied, RELOAD_PARAM } from "@/lib/canvas/useReloadOnApplied";
import { useEventStream } from "@/lib/events/EventSourceProvider";
import { EmptyPreviewBackdrop } from "./EmptyPreviewBackdrop";

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
  /** Forwarded ref so parents (e.g. CanvasPreviewClient) can call
   *  `iframe.contentWindow.postMessage` for the edit bridge. Without this
   *  the inline-edit toolbar's text/image actions silently no-op — the
   *  parent's own ref never attaches to the underlying <iframe>. */
  iframeRef?: RefObject<HTMLIFrameElement | null>;
}

export function HmrIframe({ src, title, projectId, onLoad, className, iframeRef: externalRef }: HmrIframeProps) {
  const setIframeRef = (el: HTMLIFrameElement | null) => {
    // React 19 typed RefObject.current as readonly. The parent passes a
    // useRef-created object which is still mutable at runtime; cast through
    // a minimal shape to assign without taking on React.MutableRefObject
    // (which has been removed from the new typings).
    if (externalRef) (externalRef as { current: HTMLIFrameElement | null }).current = el;
  };
  const { cacheBuster, toast, manualReload } = useReloadOnApplied(projectId);
  const lastLoadAtRef = useRef<number>(0);
  const { events } = useEventStream();

  // Detect the "engine reprovisioned the sandbox mid-ritual but our iframe
  // src still points at the dead URL" case. The factory's tryApply logs
  // `[atlas-web] sandbox stale ...` server-side and recovers via the second
  // attempt, but the client-side <iframe src=...> doesn't know the target
  // changed — it sits on a non-responding URL forever. Heuristic: when
  // `sandbox.apply.completed` lands, give the iframe up to 6s to fire its
  // onload event. If it doesn't, the URL is presumed dead — hard-reload the
  // page so the Server Component re-renders with the fresh previewUrl.
  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (!last || last.type !== "sandbox.apply.completed") return;
    const eventTs = last.ts;
    const timer = setTimeout(() => {
      if (lastLoadAtRef.current < eventTs) {
        if (typeof window !== "undefined") window.location.reload();
      }
    }, 6000);
    return () => clearTimeout(timer);
  }, [events]);

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

  // Note: iframe-resizer was previously used here to grow the iframe to its
  // content's natural height. That assumes the page inside the sandbox loads
  // iframe-resizer's child script, which our atlas-next-ts template doesn't.
  // The net effect was an iframe that mis-sized (collapsed or oversized
  // depending on flex parents) and broke scrolling. The native iframe handles
  // internal scroll for long pages out of the box when it has a fixed height
  // from its parent — which is exactly the setup CanvasPreviewClient gives it.

  if (!src) {
    return <EmptyPreviewBackdrop status="provisioning sandbox · ~5s" />;
  }

  // Manual reload is intentionally only exposed when an HMR-reload error
  // toast is showing (i.e. something actually went wrong). The redundant
  // always-on "Reload preview" button was duplicate UI — CanvasPreviewToolbar
  // already exposes a Reload button at the same level. Reference manualReload
  // here so the lint doesn't flag the import as unused and so we keep an
  // affordance to expose it later if the toast UX needs a retry hook.
  void manualReload;

  return (
    <div className="relative flex flex-col h-full">
      {toast !== null && (
        <div
          role="alert"
          data-testid="preview-reload-toast"
          className="m-2 flex items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          <span className="flex-1">{toast}</span>
          <button
            type="button"
            data-testid="preview-reload-button"
            onClick={manualReload}
            className="rounded border border-red-300 px-2 py-0.5 text-xs hover:bg-red-100"
          >
            Reload
          </button>
        </div>
      )}
      <iframe
        ref={setIframeRef}
        src={effectiveSrc}
        title={title}
        onLoad={() => {
          lastLoadAtRef.current = Date.now();
          onLoad?.();
        }}
        className={className ?? "w-full h-full border-0 rounded-lg flex-1"}
        allow="clipboard-read; clipboard-write"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />
    </div>
  );
}
