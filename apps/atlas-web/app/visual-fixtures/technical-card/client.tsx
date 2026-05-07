"use client";
import { TechnicalCard } from "@/components/a2ui/TechnicalCard";
import { cannedProposal } from "@/e2e/visual/fixtures/canned-design-proposal";

export function TechnicalCardClient() {
  return (
    <TechnicalCard
      card={cannedProposal.recommended}
      recommended
      reasoning={cannedProposal.reasoning}
      onSelect={() => {}}
      onRefine={() => {}}
    />
  );
}
