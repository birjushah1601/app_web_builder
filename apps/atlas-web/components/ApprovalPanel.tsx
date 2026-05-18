"use client";

import { useState } from "react";
import type { PersonaTier } from "@atlas/ritual-engine";

export interface ApprovalPanelProps {
  persona: PersonaTier;
  artifact: unknown;
  onApprove: () => void;
  onChangesRequested: (notes: string) => void;
}

export function ApprovalPanel({ persona, artifact, onApprove, onChangesRequested }: ApprovalPanelProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState("");

  const yesLabel = persona === "ama" ? "Yes" : "Approve";
  const noLabel = persona === "ama" ? "No" : "Request changes";

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold">Review the proposed change</h3>
      {persona !== "ama" && (
        <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-slate-50 p-2 text-xs">{JSON.stringify(artifact, null, 2)}</pre>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onApprove} className="rounded-md bg-slate-900 px-3 py-1 text-sm text-white">{yesLabel}</button>
        <button type="button" onClick={() => setShowNotes((v) => !v)} className="rounded-md border border-slate-300 px-3 py-1 text-sm">{noLabel}</button>
        {persona === "ama" && (
          <button type="button" className="rounded-md border border-slate-300 px-3 py-1 text-sm">Ask a reviewer</button>
        )}
      </div>
      {showNotes && (
        <div className="mt-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What needs to change?"
            className="block w-full rounded-md border border-slate-300 p-2 text-sm"
            rows={3}
          />
          <button
            type="button"
            disabled={!notes.trim()}
            onClick={() => onChangesRequested(notes)}
            className="mt-2 rounded-md bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >Submit</button>
        </div>
      )}
    </div>
  );
}
