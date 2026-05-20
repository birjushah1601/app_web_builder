import Link from "next/link";
import { Pool } from "pg";
import { ProjectsRepo } from "@atlas/spec-graph-data";
import { auth } from "@/lib/auth/clerk-compat";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { PromptForm } from "./projects/new/_components/PromptForm";
import { submitPromptedProject } from "./projects/new/actions";

export default async function LandingPage() {
  const { userId } = await auth();
  if (!userId) return null; // middleware redirects

  // Per-request Pool matches the pattern used by app/projects/[projectId]/layout.tsx
  // and lib/actions/setPersonaOverride.ts. Long-term we'll move to a shared
  // pool — see lib/engine/factory.ts for the cached version.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const projectsRepo = new ProjectsRepo(pool);
  const projects = await projectsRepo.listForUser(userId);

  // Plan UXO change 1 — single-page morph. When ATLAS_FF_PROMPT_MORPH is on,
  // signed-in users see the PromptForm as the hero on `/` instead of just a
  // project list. The textarea carries `data-prompt-input` so the View
  // Transitions API can animate it into the canvas chat input on submit.
  // Flag-OFF preserves today's project-list-only landing page byte-for-byte.
  const morphOn = isFeatureEnabled("prompt-morph");

  if (morphOn) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <PromptForm action={submitPromptedProject} />
        <section className="mt-16 border-t border-slate-200 pt-8">
          <h2 className="text-lg font-semibold text-slate-900">Your projects</h2>
          {projects.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No projects yet — start one above.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {projects.map((p) => (
                <li key={p.projectId}>
                  <Link
                    href={`/projects/${p.projectId}/canvas`}
                    className="text-sm text-slate-700 underline hover:text-slate-900"
                  >
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    );
  }

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
