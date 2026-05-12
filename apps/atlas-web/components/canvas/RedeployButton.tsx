"use client";
/**
 * RedeployButton — manual recovery when the E2B sandbox dies (idle timeout,
 * eviction, etc.) and the iframe is showing a dead URL. Calls the
 * redeployPreview Server Action, which evicts + reprovisions + reapplies the
 * last developer diff. On success, the canvas page reloads so the server-
 * rendered iframe re-resolves to the new previewUrl.
 *
 * Lives in the canvas header next to the demo-mode toggle so it's visible
 * but unobtrusive. Hidden inside `<details>` until you need it — the happy
 * path doesn't surface it.
 */
import * as React from "react";
import { redeployPreview } from "@/lib/actions/redeployPreview";

export function RedeployButton({ projectId }: { projectId: string }) {
  const [status, setStatus] = React.useState<"idle" | "running" | "ok" | "error">("idle");
  const [message, setMessage] = React.useState<string | null>(null);

  async function onClick() {
    setStatus("running");
    setMessage(null);
    try {
      const out = await redeployPreview(projectId);
      if (out.ok) {
        setStatus("ok");
        setMessage(`Redeployed ${out.filesWritten ?? "?"} files. Reloading…`);
        // Brief delay so the user sees the confirmation before the reload.
        setTimeout(() => window.location.reload(), 600);
      } else {
        setStatus("error");
        setMessage(out.error ?? "redeploy failed");
      }
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={onClick}
        disabled={status === "running"}
        className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-50"
        title="Reapply the last generated diff to a fresh sandbox. Useful when the preview iframe shows a dead sandbox."
      >
        {status === "running" ? "Redeploying…" : "Redeploy preview"}
      </button>
      {message && (
        <span
          role="status"
          className={status === "error" ? "text-red-600" : "text-slate-600"}
        >
          {message}
        </span>
      )}
    </div>
  );
}
