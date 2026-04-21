"use client";

import { useState } from "react";

export interface ChatPanelProps {
  projectId: string;
  onSend: (userTurn: string) => Promise<string>;
}

export function ChatPanel({ onSend }: ChatPanelProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<Array<{ role: "user"; text: string }>>([]);

  async function send() {
    if (!text.trim() || pending) return;
    setPending(true);
    setHistory((h) => [...h, { role: "user", text }]);
    try {
      await onSend(text);
      setText("");
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
