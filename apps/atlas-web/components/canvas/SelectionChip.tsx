"use client";
import * as React from "react";

export interface SelectionChipProps {
  label: string;
  onRemove: () => void;
}

export function SelectionChip({ label, onRemove }: SelectionChipProps) {
  return (
    <div
      data-testid="selection-chip"
      className="mb-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide">Editing</span>
      <span className="max-w-[20ch] truncate font-mono">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove selection"
        className="text-emerald-700 hover:text-emerald-900"
      >
        ✕
      </button>
    </div>
  );
}
