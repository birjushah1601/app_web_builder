"use client";
import { ModeToggle } from "@/components/canvas/ModeToggle";

const MODES = [
  { id: "designing", label: "Designing" },
  { id: "preview", label: "Preview" },
  { id: "schema", label: "Schema" },
  { id: "refine", label: "Refine" }
];

export function ModeToggleClient({ active }: { active: string }) {
  return (
    <div data-testid="mode-toggle">
      <ModeToggle modes={MODES} active={active} onChange={() => {}} />
    </div>
  );
}
