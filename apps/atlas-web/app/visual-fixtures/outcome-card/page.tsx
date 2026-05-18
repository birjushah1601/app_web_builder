// Visual fixture route: standalone <OutcomeCard> (ama-tier rendering of a
// single recommended direction).
import { OutcomeCardClient } from "./client";

export const dynamic = "force-dynamic";

export default function OutcomeCardFixture() {
  return (
    <main className="p-6">
      <OutcomeCardClient />
    </main>
  );
}
