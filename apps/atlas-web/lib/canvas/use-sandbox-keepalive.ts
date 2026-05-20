"use client";
import { useEffect } from "react";

/**
 * Sandbox keep-alive — pings the E2B preview URL every `intervalMs` while
 * the canvas tab is visible. Without this, E2B's edge proxy pauses
 * sandboxes after ~5 minutes of zero traffic and then GCs paused ones,
 * so refreshing the canvas after a coffee break hits "Paused sandbox not
 * found" and forces a redeploy round-trip.
 *
 * The fetch uses `mode: "no-cors"` so it always succeeds at the network
 * layer (we don't care about the response — E2B's idle timer just needs
 * to see a request arrive). When the tab is hidden the interval stops,
 * so closing the canvas naturally lets the sandbox expire instead of
 * burning quota.
 */
export function useSandboxKeepalive(
  previewUrl: string | undefined,
  intervalMs: number = 90_000
): void {
  useEffect(() => {
    if (!previewUrl) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const ping = () => {
      void fetch(previewUrl, { mode: "no-cors", cache: "no-store" }).catch(() => {
        // network errors are expected with no-cors; the request still
        // reaches E2B and resets the idle timer
      });
    };

    const start = () => {
      if (timer !== null) return;
      ping();
      timer = setInterval(ping, intervalMs);
    };

    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [previewUrl, intervalMs]);
}
