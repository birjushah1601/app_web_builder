/**
 * Plan #15 — Event log viewer.
 *
 * Server Component that reads up to 200 spec_events for the project,
 * newest first, and hands them to <EventsTable> for client-side
 * expansion + Refresh-by-router.refresh(). No SSE; the audit-log
 * surface is fundamentally cold storage and a manual refresh is the
 * cheapest correct UX for now.
 */

import { listProjectEvents } from "@/lib/events/listProjectEvents";
import { EventsTable } from "./_components/EventsTable";

export const dynamic = "force-dynamic";

export default async function EventsPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const events = await listProjectEvents(projectId, 200);
  return (
    <main className="flex h-full flex-col">
      <header
        data-testid="events-page-header"
        className="border-b border-slate-200 bg-white px-4 py-2"
      >
        <h1 className="text-sm font-medium text-slate-700">Project events</h1>
        <p className="text-xs text-slate-500">
          spec_events for project <span className="font-mono">{projectId}</span> — newest 200
        </p>
      </header>
      <div className="flex-1 overflow-auto bg-white">
        <EventsTable events={events} />
      </div>
    </main>
  );
}
