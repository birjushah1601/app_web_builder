"use client";
import * as React from "react";
import { uploadElementImage } from "@/lib/actions/uploadElementImage";

export interface ImageReplacePopoverProps {
  onSubmit: (input: { url: string; alt?: string }) => void;
  onClose: () => void;
}

export function ImageReplacePopover({ onSubmit, onClose }: ImageReplacePopoverProps) {
  const [url, setUrl] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const out = await uploadElementImage(fd);
      onSubmit({ url: out.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Replace image"
      className="absolute z-50 w-72 rounded-md border border-slate-300 bg-white p-3 text-xs shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">Replace image</span>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-900">✕</button>
      </div>
      <div
        onDrop={async (e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) await onFile(f);
        }}
        onDragOver={(e) => e.preventDefault()}
        className="rounded border-2 border-dashed border-slate-300 p-3 text-center text-slate-500"
      >
        {uploading ? "Uploading…" : "Drop an image here"}
      </div>
      <div className="mt-2 flex gap-1">
        <input
          type="text"
          placeholder="Or paste URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded border border-slate-300 px-2 py-1"
        />
        <button
          type="button"
          disabled={!url}
          onClick={() => onSubmit({ url })}
          className="rounded bg-slate-900 px-2 py-1 text-white disabled:opacity-50"
        >
          Apply
        </button>
      </div>
      {error && <div role="alert" className="mt-2 text-red-600">{error}</div>}
    </div>
  );
}
