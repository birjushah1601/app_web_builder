// Visual fixture route: standalone <AxisWizard> with the canonical
// 3-axis sequence (palette → typography → density) at step 1.
import { AxisWizardClient } from "./client";

export const dynamic = "force-dynamic";

export default function AxisWizardFixture() {
  return (
    <main className="container mx-auto p-8">
      <AxisWizardClient />
    </main>
  );
}
