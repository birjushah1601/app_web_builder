"use client";
import { RefineWizard } from "@/components/canvas/renderers/RefineWizard";

export function RefineWizardClient() {
  return (
    <div data-testid="refine-wizard-fixture" style={{ height: 800 }}>
      <RefineWizard fromDirectionId="editorial-dark" onComplete={() => {}} />
    </div>
  );
}
