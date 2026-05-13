"use client";
/**
 * DesignerCanvas — designing-mode renderer for the canvas shell.
 *
 * Wraps S.3's <OptionsCard> at canvas size. Receives a DesignProposal
 * (recommended + 2 alternates + reasoning), forwards onSelect / onRefine
 * up to the page so it can dispatch to the engine.
 */
import * as React from "react";
import type { DesignProposal } from "@atlas/role-designer";
import type { PersonaTier } from "@atlas/ritual-engine";
import { OptionsCard } from "@/components/a2ui/OptionsCard";

export interface DesignerCanvasProps {
  /** Undefined when the canvas mounted in "designing" mode before the
   *  Designer's proposal event arrived. Render a skeleton in that window. */
  proposal?: DesignProposal;
  persona: PersonaTier;
  onSelect?: (directionId: string) => void;
  onRefine?: (directionId: string) => void;
  /** Optimistic-submission feedback: when the user has clicked "Use this"
   *  on a direction, CanvasShellWired sets this to that direction id so we
   *  render a non-blocking "Generating your site…" overlay until the
   *  canvas auto-switches to preview mode on sandbox.apply.completed. */
  submittedDirectionId?: string;
}

export function DesignerCanvas({ proposal, persona, onSelect, onRefine, submittedDirectionId }: DesignerCanvasProps) {
  if (!proposal) {
    return (
      <div
        data-testid="designer-canvas-loading"
        className="flex h-full w-full items-center justify-center bg-slate-50 p-6 text-slate-500"
      >
        Generating design options…
      </div>
    );
  }
  const handleSelect = onSelect ?? (() => {});
  const handleRefine = onRefine ?? (() => {});
  const recommended = {
    id: proposal.recommended.id,
    name: proposal.recommended.name,
    shortDescription: proposal.recommended.shortDescription,
    technicalDescription: proposal.recommended.technicalDescription,
    citedReferences: proposal.recommended.citedReferences
  };
  const alternates = proposal.alternates.map((a) => ({
    id: a.id,
    name: a.name,
    shortDescription: a.shortDescription,
    technicalDescription: a.technicalDescription,
    citedReferences: a.citedReferences
  }));

  return (
    <div data-testid="designer-canvas" className="relative h-full w-full overflow-auto bg-slate-50 p-6">
      <OptionsCard
        recommended={recommended}
        alternates={alternates}
        reasoning={proposal.reasoning}
        persona={persona}
        onSelect={handleSelect}
        onRefine={handleRefine}
      />
      {submittedDirectionId !== undefined && (
        <div
          data-testid="designer-canvas-generating-overlay"
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/85 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-3 rounded-lg bg-white px-6 py-5 shadow-lg ring-1 ring-slate-200">
            <div
              aria-hidden
              className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-200 border-t-emerald-600"
            />
            <div className="text-center">
              <div className="text-sm font-semibold text-slate-900">Generating your site…</div>
              <div className="mt-1 text-xs text-slate-500">
                Sourcing assets → writing code → applying to preview. Usually 30–90s.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DesignerCanvas;
