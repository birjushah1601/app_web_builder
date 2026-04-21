"use client";

import type { PersonaTier } from "@atlas/ritual-engine";

interface Props {
  current: PersonaTier;
  onChange: (next: PersonaTier) => void;
}

const ALL: PersonaTier[] = ["ama", "diego", "priya"];

export function PersonaToggle({ current, onChange }: Props) {
  return (
    <div role="group" aria-label="Persona tier" className="inline-flex rounded-md border border-slate-300 overflow-hidden">
      {ALL.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={p === current}
          onClick={() => onChange(p)}
          className={`px-3 py-1 text-sm capitalize ${p === current ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
