// Visual fixture route: standalone <ModeToggle> with the canned canvas
// manifest's modes. The active mode is driven by the `?state=` search
// param so the visual spec can iterate over states deterministically.
import { ModeToggleClient } from "./client";

export const dynamic = "force-dynamic";

export default async function ModeToggleFixture({
  searchParams
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const sp = await searchParams;
  const active = sp.state ?? "designing";
  return (
    <main className="p-6">
      <ModeToggleClient active={active} />
    </main>
  );
}
