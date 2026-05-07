// Visual fixture route: <RefineWizard> at the palette step. Persona is
// honored even though refine renders the same UI for all tiers — used for
// per-persona snapshot variance only if downstream components diverge.
import { RefineWizardClient } from "./client";

export const dynamic = "force-dynamic";

export default function RefineWizardFixture() {
  return (
    <main className="container mx-auto p-8">
      <RefineWizardClient />
    </main>
  );
}
