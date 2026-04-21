"use client";

import { useEffect, useRef } from "react";

interface HmrIframeProps {
  src: string | undefined;
  title: string;
  onLoad?: () => void;
  className?: string;
}

export function HmrIframe({ src, title, onLoad, className }: HmrIframeProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!iframeRef.current || !src) return;
    // Dynamically import iframe-resizer to avoid SSR issues
    import("iframe-resizer").then(({ iframeResize }) => {
      if (iframeRef.current) {
        iframeResize({ log: false, checkOrigin: false }, iframeRef.current);
      }
    });
  }, [src]);

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
    <iframe
      ref={iframeRef}
      src={src}
      title={title}
      onLoad={onLoad}
      className={className ?? "w-full h-full border-0 rounded-lg"}
      allow="clipboard-read; clipboard-write"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}
