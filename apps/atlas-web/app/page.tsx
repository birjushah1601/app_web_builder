import Link from "next/link";
import { Pool } from "pg";
import { ProjectsRepo } from "@atlas/spec-graph-data";
import { auth } from "@/lib/auth/clerk-compat";

export default async function LandingPage() {
  const { userId } = await auth();
  if (!userId) return null; // middleware redirects

  // Per-request Pool matches the pattern used by app/projects/[projectId]/layout.tsx
  // and lib/actions/setPersonaOverride.ts. Long-term we'll move to a shared
  // pool — see lib/engine/factory.ts for the cached version.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const projectsRepo = new ProjectsRepo(pool);
  const projects = await projectsRepo.listForUser(userId);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Your projects</h1>
      <p className="mt-2 text-sm text-slate-600">Visualize → Agree → Build</p>
      <div className="mt-6">
        <Link href="/projects/new" className="rounded-md bg-slate-900 px-4 py-2 text-white">+ New project</Link>
      </div>
      {projects.length === 0 ? (
        <p className="mt-8 text-slate-500">
          No projects yet.{" "}
          <Link href="/projects/new" className="underline">
            Create your first one →
          </Link>
        </p>
      ) : (
        <ul className="mt-8 space-y-2">
          {projects.map((p) => (
            <li key={p.projectId}>
              <Link href={`/projects/${p.projectId}/canvas`} className="underline">
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
