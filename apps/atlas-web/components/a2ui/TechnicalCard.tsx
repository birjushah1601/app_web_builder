"use client";
import * as React from "react";
import type { DirectionCard } from "./OptionsCard";

export interface TechnicalCardProps {
  card: DirectionCard;
  recommended: boolean;
  reasoning?: string;
  onSelect: () => void;
  onRefine: () => void;
}

export function TechnicalCard({ card, recommended, reasoning, onSelect, onRefine }: TechnicalCardProps) {
  const ringClass = recommended ? "ring-2 ring-emerald-500 shadow-md" : "";
  return (
    <div data-testid="technical-card" data-direction-id={card.id} className={`rounded-lg border border-slate-200 bg-white p-5 ${ringClass}`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-semibold">{card.name}</h3>
        {recommended && (
          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
            Recommended
          </span>
        )}
      </div>
      <p className="mb-2 text-sm text-slate-700">{card.shortDescription}</p>
      <p className="mb-3 text-xs font-mono text-slate-500">{card.technicalDescription}</p>
      {card.citedReferences.length > 0 && (
        <p className="mb-3 text-xs text-slate-500">
          Cited from: <em>{card.citedReferences.join(", ")}</em>
        </p>
      )}
      {recommended && reasoning && <p className="mb-3 text-xs italic text-slate-500">{reasoning}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={onSelect} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
          Use this →
        </button>
        <button type="button" onClick={onRefine} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50">
          Refine
        </button>
      </div>
    </div>
  );
}
