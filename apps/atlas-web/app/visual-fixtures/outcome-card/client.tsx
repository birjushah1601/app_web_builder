"use client";
import { OutcomeCard } from "@/components/a2ui/OutcomeCard";
import { cannedProposal } from "@/e2e/visual/fixtures/canned-design-proposal";

export function OutcomeCardClient() {
  return (
    <OutcomeCard
      card={cannedProposal.recommended}
      recommended
      reasoning={cannedProposal.reasoning}
      onSelect={() => {}}
      onRefine={() => {}}
    />
  );
}
