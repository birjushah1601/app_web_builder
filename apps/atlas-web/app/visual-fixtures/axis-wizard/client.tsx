"use client";
import { AxisWizard, type Axis } from "@/components/a2ui/AxisWizard";

const SWATCH_BLANK =
  '<svg width="40" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="20" rx="4" fill="#cbd5e1"/></svg>';

const AXES: Axis[] = [
  {
    id: "palette",
    label: "Pick a palette",
    educationalTooltip:
      "A palette is the small set of colors that ties everything together — the mood of your app.",
    options: [
      { id: "editorial", name: "Editorial", swatchSvg: SWATCH_BLANK, educationCopy: "Black + gold = serious + premium.", funFact: "Used by Eleven Madison Park." },
      { id: "warm", name: "Warm", swatchSvg: SWATCH_BLANK, educationCopy: "Cream + terracotta = friendly café.", funFact: "Common in Mediterranean cafes." },
      { id: "cool", name: "Cool", swatchSvg: SWATCH_BLANK, educationCopy: "Slate + blue = tech-forward.", funFact: "Stripe and Linear use cool tones." }
    ]
  },
  {
    id: "typography",
    label: "Pick a typography pairing",
    educationalTooltip: "Typography sets the tone before anyone reads a word.",
    options: [
      { id: "serif-sans", name: "Serif heads + sans body", swatchSvg: SWATCH_BLANK, educationCopy: "Editorial feel.", funFact: "Magazines pioneered this in the 1960s." },
      { id: "all-sans", name: "All sans-serif", swatchSvg: SWATCH_BLANK, educationCopy: "Clean, modern, technical.", funFact: "Inter was designed for screens specifically." },
      { id: "humanist", name: "Humanist sans", swatchSvg: SWATCH_BLANK, educationCopy: "Friendly without being playful.", funFact: "Used by GOV.UK." }
    ]
  },
  {
    id: "density",
    label: "Pick a density",
    educationalTooltip: "Density is how packed your screen feels.",
    options: [
      { id: "spacious", name: "Spacious", swatchSvg: SWATCH_BLANK, educationCopy: "Lots of breathing room.", funFact: "Apple uses generous spacing." },
      { id: "comfortable", name: "Comfortable", swatchSvg: SWATCH_BLANK, educationCopy: "Balanced — the safe default.", funFact: "Most consumer apps live here." },
      { id: "compact", name: "Compact", swatchSvg: SWATCH_BLANK, educationCopy: "Information-dense.", funFact: "Linear and Notion lean compact." }
    ]
  }
];

export function AxisWizardClient() {
  return <AxisWizard axes={AXES} onComplete={() => {}} />;
}
