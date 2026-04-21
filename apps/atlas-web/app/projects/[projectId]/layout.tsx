import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Pool } from "pg";
import { PreferencesRepo } from "@atlas/spec-graph-data";

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

  // Resolve persona for this project (override → metadata → ama)
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prefs = new PreferencesRepo(pool);
  const override = await prefs.getOverride(userId, projectId);
  const user = await currentUser();
  const persona = override ?? (user?.publicMetadata?.defaultPersona as string | undefined) ?? "ama";

  return (
    <div className="flex flex-col">
      <nav className="flex items-center gap-4 border-b border-slate-200 px-4 py-2">
        <Link href={`/projects/${projectId}/canvas`} className="text-sm hover:underline">Canvas</Link>
        <Link href={`/projects/${projectId}/code`} className="text-sm hover:underline">Code</Link>
        <span className="ml-auto text-xs text-slate-500">Persona: {persona}</span>
      </nav>
      {children}
    </div>
  );
}
