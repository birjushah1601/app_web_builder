// Visual fixture route: standalone <TechnicalCard> (diego/priya tier).
import { TechnicalCardClient } from "./client";

export const dynamic = "force-dynamic";

export default function TechnicalCardFixture() {
  return (
    <main className="p-6">
      <TechnicalCardClient />
    </main>
  );
}
