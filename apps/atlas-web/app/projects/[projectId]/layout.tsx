import Link from "next/link";
import { Pool } from "pg";
import { PreferencesRepo } from "@atlas/spec-graph-data";
import { auth, currentUser } from "@/lib/auth/clerk-compat";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { EventSourceProvider } from "@/lib/events/EventSourceProvider";
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

  const topNav = (
    <nav className="flex items-center gap-4 border-b border-slate-200 px-4 py-2">
      <Link href={`/projects/${projectId}/canvas`} className="text-sm hover:underline">Canvas</Link>
      <Link href={`/projects/${projectId}/code`} className="text-sm hover:underline">Code</Link>
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
      <EventSourceProvider projectId={projectId} flagEnabled={true}>
        <div className="flex h-screen flex-col">
          {topNav}
          <RitualStatusStrip />
          <div className="flex flex-1 min-h-0">
            <EditorShell
              projectId={projectId}
              left={<RailShell projectId={projectId} multiTurnFlagEnabled={multiTurnOn} />}
              right={<main className="flex-1 min-w-0 overflow-auto">{children}</main>}
            />
          </div>
        </div>
      </EventSourceProvider>
    );
  }

  return (
    <EventSourceProvider projectId={projectId} flagEnabled={true}>
      <div className="flex h-screen flex-col">
        {topNav}
        <div className="flex flex-1 min-h-0">
          <RailShell projectId={projectId} multiTurnFlagEnabled={multiTurnOn} />
          <main className="flex-1 min-w-0 overflow-auto">{children}</main>
        </div>
      </div>
    </EventSourceProvider>
  );
}
