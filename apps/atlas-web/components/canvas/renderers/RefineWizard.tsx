"use client";
/**
 * RefineWizard — refinement-mode renderer for the canvas shell.
 *
 * Wraps S.3's <AxisWizard> with the canonical 3-axis sequence:
 * palette → typography → density. Each axis carries an educational
 * tooltip (Geist-style: explain what you're choosing, then let me
 * choose). The completed selection bubbles up via onComplete.
 */
import * as React from "react";
import { AxisWizard, type Axis } from "@/components/a2ui/AxisWizard";

export interface RefineWizardProps {
  fromDirectionId: string;
  onComplete: (selection: Record<string, string>) => void;
}

const SWATCH_BLANK = '<svg width="40" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="20" rx="4" fill="#cbd5e1"/></svg>';

const AXES: Axis[] = [
  {
    id: "palette",
    label: "Pick a palette",
    educationalTooltip:
      "A palette is the small set of colors that ties everything together. Think of it as the mood of your app — premium, friendly, or technical.",
    options: [
      { id: "editorial", name: "Editorial", swatchSvg: SWATCH_BLANK, educationCopy: "Black + gold = serious + premium.", funFact: "Used by Eleven Madison Park." },
      { id: "warm", name: "Warm", swatchSvg: SWATCH_BLANK, educationCopy: "Cream + terracotta = friendly café.", funFact: "Common in Mediterranean cafes." },
      { id: "cool", name: "Cool", swatchSvg: SWATCH_BLANK, educationCopy: "Slate + blue = tech-forward.", funFact: "Stripe and Linear use cool tones." }
    ]
  },
  {
    id: "typography",
    label: "Pick a typography pairing",
    educationalTooltip:
      "Typography sets the tone before anyone reads a word. Serif heads feel editorial; all-sans feels modern and clean.",
    options: [
      { id: "serif-sans", name: "Serif heads + sans body", swatchSvg: SWATCH_BLANK, educationCopy: "Editorial feel — premium, considered.", funFact: "Magazines pioneered this in the 1960s." },
      { id: "all-sans", name: "All sans-serif", swatchSvg: SWATCH_BLANK, educationCopy: "Clean, modern, technical.", funFact: "Inter was designed for screens specifically." },
      { id: "humanist", name: "Humanist sans", swatchSvg: SWATCH_BLANK, educationCopy: "Friendly without being playful.", funFact: "Used by GOV.UK for accessibility." }
    ]
  },
  {
    id: "density",
    label: "Pick a density",
    educationalTooltip:
      "Density is how packed your screen feels. Spacious feels editorial and calm; compact feels productive and dense.",
    options: [
      { id: "spacious", name: "Spacious", swatchSvg: SWATCH_BLANK, educationCopy: "Lots of breathing room.", funFact: "Apple uses generous spacing on marketing pages." },
      { id: "comfortable", name: "Comfortable", swatchSvg: SWATCH_BLANK, educationCopy: "Balanced — the safe default.", funFact: "Most consumer apps live here." },
      { id: "compact", name: "Compact", swatchSvg: SWATCH_BLANK, educationCopy: "Information-dense.", funFact: "Linear and Notion lean compact." }
    ]
  }
];

export function RefineWizard({ fromDirectionId, onComplete }: RefineWizardProps) {
  return (
    <div
      data-testid={`refine-wizard-${fromDirectionId}`}
      className="h-full w-full overflow-auto bg-slate-50 p-6"
    >
      <AxisWizard axes={AXES} onComplete={onComplete} />
    </div>
  );
}

export default RefineWizard;
