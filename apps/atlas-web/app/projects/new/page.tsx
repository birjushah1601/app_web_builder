import { redirect } from "next/navigation";
import { Pool } from "pg";
import { ProjectsRepo } from "@atlas/spec-graph-data";
import { auth } from "@/lib/auth/clerk-compat";

async function createProject(formData: FormData): Promise<void> {
  "use server";
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  const name = String(formData.get("name") ?? "untitled").trim() || "untitled";

  // Per-request Pool — matches the pattern used elsewhere in atlas-web
  // (see lib/actions/setPersonaOverride.ts). Eventually this should move
  // to a shared pool to avoid connection churn.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const projectsRepo = new ProjectsRepo(pool);
  const project = await projectsRepo.create({ userId, name });

  // Preserve the bootstrap=1 + name= contract that drives initial ritual
  // kickoff on the canvas page (see app/projects/[projectId]/canvas/page.tsx).
  redirect(`/projects/${project.projectId}/canvas?bootstrap=1&name=${encodeURIComponent(project.name)}`);
}

export default function NewProjectPage() {
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">New project</h1>
      <form action={createProject} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Project name</span>
          <input name="name" required className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-white">Create</button>
      </form>
    </main>
  );
}
