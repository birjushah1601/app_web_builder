"use client";
import { OptionsCard } from "@/components/a2ui/OptionsCard";
import { cannedProposal } from "@/e2e/visual/fixtures/canned-design-proposal";
import type { PersonaTier } from "@atlas/ritual-engine";

export function DesignerCanvasClient({ persona }: { persona: PersonaTier }) {
  return (
    <OptionsCard
      recommended={cannedProposal.recommended}
      alternates={cannedProposal.alternates}
      reasoning={cannedProposal.reasoning}
      persona={persona}
      onSelect={() => {}}
      onRefine={() => {}}
    />
  );
}
