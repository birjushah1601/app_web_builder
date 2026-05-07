"use client";
import * as React from "react";
import type { PersonaTier } from "@atlas/ritual-engine";
import { OutcomeCard } from "./OutcomeCard";
import { TechnicalCard } from "./TechnicalCard";

export interface DirectionCard {
  id: string;
  name: string;
  shortDescription: string;
  technicalDescription: string;
  citedReferences: string[];
  cardPayload?: Record<string, unknown>;
}

export interface OptionsCardProps {
  recommended: DirectionCard;
  alternates: DirectionCard[];
  reasoning: string;
  persona: PersonaTier;
  onSelect: (directionId: string) => void;
  onRefine: (directionId: string) => void;
}

export function OptionsCard(props: OptionsCardProps) {
  const Renderer = props.persona === "ama" ? OutcomeCard : TechnicalCard;
  return (
    <div data-testid="options-card" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-1">
        <Renderer
          card={props.recommended}
          recommended
          reasoning={props.reasoning}
          onSelect={() => props.onSelect(props.recommended.id)}
          onRefine={() => props.onRefine(props.recommended.id)}
        />
      </div>
      {props.alternates.map((alt) => (
        <Renderer
          key={alt.id}
          card={alt}
          recommended={false}
          onSelect={() => props.onSelect(alt.id)}
          onRefine={() => props.onRefine(alt.id)}
        />
      ))}
    </div>
  );
}
