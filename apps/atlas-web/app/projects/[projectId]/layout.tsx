import Link from "next/link";
import { Pool } from "pg";
import { PreferencesRepo } from "@atlas/spec-graph-data";
import { auth, currentUser } from "@/lib/auth/clerk-compat";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getLatestRitualForProject } from "@/lib/actions/getLatestRitualForProject";
import { EventSourceProvider } from "@/lib/events/EventSourceProvider";
import { getInitialEventsForProject } from "@/lib/events/getInitialEventsForProject";
import { RailShell } from "@/components/shell/RailShell";
import { RitualStatusStrip } from "@/components/ritual/RitualStatusStrip";
import { EditorShell } from "@/components/shell/EditorShell";

export default async function ProjectLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { userId } = await auth();
  if (!userId) return null;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prefs = new PreferencesRepo(pool);
  const override = await prefs.getOverride(userId, projectId);
  const user = await currentUser();
  const persona =
    override ?? (user?.publicMetadata?.defaultPersona as string | undefined) ?? "ama";

  const liveEventsOn = isFeatureEnabled("live-events");
  const multiTurnOn = isFeatureEnabled("multi-turn");
  const editorLayoutV2On = isFeatureEnabled("editor-layout-v2");
  // Plan UXO Task 6 — gate ReferenceDropZone in RailShell's ChatPanel.
  const referenceInputOn = isFeatureEnabled("reference-input");
  // Plan UXO Task 7 — gate CritiqueDisclosure in the rail's RitualTimeline.
  const editablePlanOn = isFeatureEnabled("editable-plan");
  // Plan U — gate the structured triage clarification form in ChatPanel.
  const structuredTriageOn = isFeatureEnabled("structured-triage");
  // Refine-by-default — server-side fetch of the most recent ritualId so
  // ChatPanel auto-routes the next submit through refineRitual. Failure-safe:
  // returns null when DB unreachable OR project has no rituals yet → ChatPanel
  // falls back to the cold-start path.
  const latestRitual = multiTurnOn ? await getLatestRitualForProject(projectId) : null;
  const initialLatestRitualId = latestRitual?.ritualId;
  // Bug D17 — hydrate EventSourceProvider with the most recent persisted
  // events so the canvas/timeline isn't blank when a ritual already ran.
  // Failure-safe: getInitialEventsForProject returns [] on any error so
  // the page still renders; SSE picks up live events from here on. Only
  // worth the round-trip when live-events is on (the provider is a literal
  // no-op otherwise).
  const initialEvents = liveEventsOn ? await getInitialEventsForProject(projectId) : [];

  const topNav = (
    <nav className="flex items-center gap-4 border-b border-slate-200 px-4 py-2">
      <Link href={`/projects/${projectId}/canvas`} className="text-sm hover:underline">Canvas</Link>
      <Link href={`/projects/${projectId}/code`} className="text-sm hover:underline">Code</Link>
      <Link href={`/projects/${projectId}/events`} className="text-sm hover:underline">Events</Link>
      <span className="ml-auto text-xs text-slate-500">Persona: {persona}</span>
    </nav>
  );

  if (!liveEventsOn) {
    return (
      <div className="flex flex-col">
        {topNav}
        {children}
      </div>
    );
  }

  if (editorLayoutV2On) {
    return (
      <EventSourceProvider projectId={projectId} flagEnabled={true} initialEvents={initialEvents}>
        <div className="flex h-screen flex-col">
          {topNav}
          <RitualStatusStrip />
          <div className="flex flex-1 min-h-0">
            <EditorShell
              projectId={projectId}
              left={<RailShell projectId={projectId} multiTurnFlagEnabled={multiTurnOn} referenceInputEnabled={referenceInputOn} editablePlanEnabled={editablePlanOn} structuredTriageEnabled={structuredTriageOn} {...(initialLatestRitualId !== undefined ? { initialLatestRitualId } : {})} />}
              right={<main className="flex-1 min-w-0 overflow-auto">{children}</main>}
            />
          </div>
        </div>
      </EventSourceProvider>
    );
  }

  return (
    <EventSourceProvider projectId={projectId} flagEnabled={true} initialEvents={initialEvents}>
      <div className="flex h-screen flex-col">
        {topNav}
        <div className="flex flex-1 min-h-0">
          <RailShell projectId={projectId} multiTurnFlagEnabled={multiTurnOn} referenceInputEnabled={referenceInputOn} editablePlanEnabled={editablePlanOn} structuredTriageEnabled={structuredTriageOn} {...(initialLatestRitualId !== undefined ? { initialLatestRitualId } : {})} />
          <main className="flex-1 min-w-0 overflow-auto">{children}</main>
        </div>
      </div>
    </EventSourceProvider>
  );
}
