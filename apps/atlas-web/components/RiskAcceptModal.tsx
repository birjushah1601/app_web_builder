"use client";

import { useState } from "react";
import type { PersonaTier } from "@atlas/ritual-engine";

export interface RiskAcceptSubmit {
  rationale: string;
  scope: "single-commit" | "session" | "permanent-for-project";
}

export interface RiskAcceptModalProps {
  open: boolean;
  gate: "L4-security" | "L5-compliance" | "L6-a11y-advisory" | "L7-visual-advisory";
  persona: PersonaTier;
  failureSummary: string;
  onSubmit: (s: RiskAcceptSubmit) => void;
  onClose: () => void;
}

export function RiskAcceptModal({ open, gate, persona, failureSummary, onSubmit, onClose }: RiskAcceptModalProps) {
  const [rationale, setRationale] = useState("");
  const [scope, setScope] = useState<RiskAcceptSubmit["scope"]>("session");
  if (!open) return null;
  const valid = rationale.length >= 20;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="w-full max-w-md rounded-md bg-white p-4 shadow-lg">
        <h3 className="text-lg font-semibold">Accept risk for {gate}</h3>
        <p className="mt-1 text-xs text-slate-500">Persona: {persona}</p>
        <p className="mt-2 text-sm">Failure: {failureSummary}</p>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Rationale (>=20 characters)"
          className="mt-3 block w-full rounded-md border border-slate-300 p-2 text-sm"
          rows={4}
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as RiskAcceptSubmit["scope"])}
          className="mt-2 block w-full rounded-md border border-slate-300 p-2 text-sm"
        >
          <option value="single-commit">Single commit</option>
          <option value="session">Session</option>
          <option value="permanent-for-project">Permanent for project</option>
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1 text-sm">Cancel</button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => onSubmit({ rationale, scope })}
            className="rounded-md bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >Accept risk</button>
        </div>
      </div>
    </div>
  );
}
