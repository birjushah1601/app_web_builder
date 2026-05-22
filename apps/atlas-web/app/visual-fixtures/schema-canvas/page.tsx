// Visual fixture route: renders <SchemaCanvas> with a canned schema proposal.
// Persona is read server-side from the atlas-persona cookie and forwarded to
// the client component (SchemaCanvas needs callbacks, which can't cross the
// server/client boundary from a server component).
import { cookies } from "next/headers";
import type { PersonaTier } from "@atlas/ritual-engine";
import { SchemaCanvasFixtureClient } from "./fixture-client";

export const dynamic = "force-dynamic";

export default async function SchemaCanvasFixture() {
  const cookieStore = await cookies();
  const persona = (cookieStore.get("atlas-persona")?.value ?? "ama") as PersonaTier;
  return <SchemaCanvasFixtureClient persona={persona} />;
}
