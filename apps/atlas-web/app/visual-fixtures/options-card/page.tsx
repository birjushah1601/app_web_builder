// Visual fixture route: standalone <OptionsCard> with canned proposal.
// Same shape as designer-canvas but without the canvas chrome wrapper —
// snapshots the card surface in isolation.
import { cookies } from "next/headers";
import type { PersonaTier } from "@atlas/ritual-engine";
import { OptionsCardClient } from "./client";

export const dynamic = "force-dynamic";

export default async function OptionsCardFixture() {
  const cookieStore = await cookies();
  const persona = (cookieStore.get("atlas-persona")?.value ?? "ama") as PersonaTier;
  return (
    <main className="p-6">
      <OptionsCardClient persona={persona} />
    </main>
  );
}
