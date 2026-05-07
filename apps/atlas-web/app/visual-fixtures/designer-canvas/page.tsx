// Visual fixture route: renders <OptionsCard> with the canned design
// proposal. Persona is read server-side from the atlas-persona cookie and
// forwarded to a client component which mounts the actual UI (the card
// expects function callbacks which can't cross the server/client boundary
// from a server component).
import { cookies } from "next/headers";
import type { PersonaTier } from "@atlas/ritual-engine";
import { DesignerCanvasClient } from "./client";

export const dynamic = "force-dynamic";

export default async function DesignerCanvasFixture() {
  const cookieStore = await cookies();
  const persona = (cookieStore.get("atlas-persona")?.value ?? "ama") as PersonaTier;
  return (
    <main className="container mx-auto p-8">
      <DesignerCanvasClient persona={persona} />
    </main>
  );
}
