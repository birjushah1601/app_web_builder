"use client";

import { useState } from "react";

export interface RefinementInputBarProps {
  projectId: string;
  parentRitualId: string;
  flagEnabled: boolean;
  onRefine: (userTurn: string) => Promise<void>;
}

export function RefinementInputBar({
  parentRitualId,
  flagEnabled,
  onRefine
}: RefinementInputBarProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!flagEnabled) return null;

  const handleSubmit = async () => {
    if (!text.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      await onRefine(text);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2" data-parent-ritual={parentRitualId}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        placeholder="Refine: describe the change you'd like…"
        className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
        rows={2}
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={pending || !text.trim()}
          className="rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          {pending ? "Refining…" : "Refine"}
        </button>
        {error && (
          <span role="alert" className="text-xs text-red-700">{error}</span>
        )}
      </div>
    </div>
  );
}
