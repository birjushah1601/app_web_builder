"use client";

/**
 * DemoModeToggle — small checkbox + DEMO badge that lives in the canvas
 * page header. Wraps the `setDemoMode` Server Action so a click writes
 * the `atlas-demo-mode` cookie + triggers a path revalidation; the next
 * ritual the user kicks off uses canned outputs (no LLM cost).
 *
 * `initialEnabled` is computed server-side via the request-scoped flag
 * source so the checkbox renders in the right state on first paint
 * (env ON, cookie ON, env OFF + cookie unset, etc. — all collapsed to
 * a single boolean by isFeatureEnabled). After mount we keep local
 * state so the click feels instant; the server action runs in the
 * background and revalidatePath nudges the rest of the page to refresh.
 */

import { useState, useTransition } from "react";
import { setDemoMode } from "@/lib/actions/setDemoMode";

interface Props {
  projectId: string;
  initialEnabled: boolean;
}

export function DemoModeToggle({ projectId, initialEnabled }: Props) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();

  function onChange(next: boolean) {
    // Optimistic update — flip the visible state immediately so the click
    // feels instant; if the action throws we roll back.
    setEnabled(next);
    startTransition(async () => {
      try {
        await setDemoMode({ enabled: next, projectId });
      } catch (err) {
        console.error("[atlas-web] setDemoMode failed:", err);
        setEnabled(!next);
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <label
        className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-slate-700"
        data-testid="demo-mode-toggle-label"
      >
        <input
          type="checkbox"
          checked={enabled}
          disabled={isPending}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-slate-300 text-slate-700 focus:ring-1 focus:ring-slate-400"
          data-testid="demo-mode-toggle-input"
        />
        Demo mode
      </label>
      {enabled && (
        <span
          data-testid="demo-mode-badge"
          className="rounded-md border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider text-amber-900"
        >
          DEMO
        </span>
      )}
    </div>
  );
}
