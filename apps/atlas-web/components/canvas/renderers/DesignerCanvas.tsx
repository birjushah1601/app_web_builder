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
  proposal: DesignProposal;
  persona: PersonaTier;
  onSelect: (directionId: string) => void;
  onRefine: (directionId: string) => void;
}

export function DesignerCanvas({ proposal, persona, onSelect, onRefine }: DesignerCanvasProps) {
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
    <div data-testid="designer-canvas" className="h-full w-full overflow-auto bg-slate-50 p-6">
      <OptionsCard
        recommended={recommended}
        alternates={alternates}
        reasoning={proposal.reasoning}
        persona={persona}
        onSelect={onSelect}
        onRefine={onRefine}
      />
    </div>
  );
}

export default DesignerCanvas;
