"use client";

/**
 * Plan UXO Task 6 — ReferenceDropZone.
 *
 * Users drop one or more screenshots; each is POSTed through the
 * uploadReference Server Action which returns a stable `/api/atlas-references/…`
 * URL. The collected references bubble up via `onAdd` so the parent form
 * (PromptForm / ChatPanel) can thread them into the startRitual call's
 * `referenceImages` field.
 *
 * The component owns its own preview list — the parent only needs to
 * remember the URLs it has been handed. Re-mounting the parent will
 * clear the preview list, which matches today's "fresh prompt" semantic.
 */

import * as React from "react";
import { uploadReference } from "@/lib/actions/uploadReference";

export interface ReferenceImage {
  url: string;
  caption?: string;
}

export interface ReferenceDropZoneProps {
  onAdd: (ref: ReferenceImage) => void;
}

export function ReferenceDropZone({ onAdd }: ReferenceDropZoneProps) {
  const [refs, setRefs] = React.useState<ReadonlyArray<{ url: string }>>([]);
  const [error, setError] = React.useState<string | null>(null);

  async function handleFile(file: File): Promise<void> {
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const out = await uploadReference(fd);
      setRefs((cur) => [...cur, out]);
      onAdd({ url: out.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div
      data-testid="reference-drop-zone"
      onDrop={async (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) await handleFile(file);
      }}
      onDragOver={(e) => e.preventDefault()}
      className="rounded-md border-2 border-dashed border-slate-300 p-2 text-xs text-slate-500"
    >
      <span>Drop a screenshot here to style-match · {refs.length} attached</span>
      {refs.map((r, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={r.url + i}
          src={r.url}
          alt={`reference ${i + 1}`}
          className="ml-2 inline-block h-12 w-12 rounded object-cover"
        />
      ))}
      {error && (
        <span role="alert" className="ml-2 text-red-600">
          {error}
        </span>
      )}
    </div>
  );
}
