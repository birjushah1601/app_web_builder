"use client";

import { useState } from "react";

export interface ChatPanelProps {
  projectId: string;
  /**
   * Server Action reference — must be the raw action export, not an inline
   * closure. React 19 serializes server actions across the RSC boundary but
   * refuses to serialize user-defined closures.
   */
  action: (input: {
    projectId: string;
    userTurn: string;
    editClass: "structural" | "cosmetic";
  }) => Promise<string>;
}

export function ChatPanel({ projectId, action }: ChatPanelProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ role: "user"; text: string }>>([]);

  async function send() {
    if (!text.trim() || pending) return;
    setPending(true);
    setError(null);
    setHistory((h) => [...h, { role: "user", text }]);
    try {
      await action({ projectId, userTurn: text, editClass: "structural" });
      setText("");
    } catch (err) {
      // Surface the failure so users don't experience a silent "the button did nothing"
      // crash. The message is intentionally short — full stacks belong in server logs.
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="flex h-full w-80 flex-col border-l border-slate-200">
      <div className="flex-1 overflow-y-auto p-3">
        {history.map((m, i) => (
          <div key={i} className="mb-2 text-sm"><strong>You:</strong> {m.text}</div>
        ))}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="border-t border-slate-200 p-2"
      >
        {error && (
          <div role="alert" className="mb-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
            {error}
          </div>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe your change…"
          className="block w-full resize-none rounded-md border border-slate-300 p-2 text-sm"
          rows={3}
          disabled={pending}
        />
        <button type="submit" disabled={pending || !text.trim()} className="mt-2 rounded-md bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50">Send</button>
      </form>
    </aside>
  );
}
