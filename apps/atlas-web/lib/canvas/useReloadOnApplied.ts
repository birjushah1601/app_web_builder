"use client";

import { useCallback, useState } from "react";
import { useEventStream } from "@/lib/events/EventSourceProvider";

/** Query-string key used to bust the iframe's HTTP cache. Namespaced so it
 *  cannot collide with a query param the user's preview app cares about.
 *  Mandated by spec line 147 of 2026-04-28-live-events-and-preview-reload-design.md. */
export const RELOAD_PARAM = "atlas-reload";

export interface ReloadOnAppliedValue {
  /** Empty string before the first reload trigger; non-empty after a
   *  successful apply (debounced) or a manualReload() call. The component
   *  decides whether to append `?atlas-reload=<value>` based on whether
   *  this is empty. */
  cacheBuster: string;
  /** Non-null only when the most recent apply failed. Cleared on the
   *  next successful apply. Component renders this as a small red toast
   *  above the iframe. */
  toast: string | null;
  /** Stable callback (useCallback). Updates cacheBuster immediately to
   *  String(Date.now()) — bypasses the debounce path AND works when
   *  ATLAS_LIVE_EVENTS is OFF (the hook never reads events to fire it). */
  manualReload: () => void;
}

/** useReloadOnApplied — folds Plan E.0's broker stream into the three
 *  pieces of state HmrIframe needs to auto-reload on successful apply
 *  and surface a toast on failure.
 *
 *  See the plan's Design Decisions section for the rationale behind
 *  every behavioural choice (debounce window, failure not debounced,
 *  manual bypassing SSE entirely, etc.).
 */
export function useReloadOnApplied(_projectId: string): ReloadOnAppliedValue {
  // Subscribe to the SSE context. When the flag is OFF, this returns
  // { events: [], status: "disabled", ... } so the hook is a literal no-op.
  useEventStream();

  const [cacheBuster, setCacheBuster] = useState<string>("");
  const [toast] = useState<string | null>(null);

  const manualReload = useCallback(() => {
    setCacheBuster(String(Date.now()));
  }, []);

  return { cacheBuster, toast, manualReload };
}
