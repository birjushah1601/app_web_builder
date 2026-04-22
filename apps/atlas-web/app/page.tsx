import Link from "next/link";
import { auth } from "@/lib/auth/clerk-compat.js";

export default async function LandingPage() {
  const { userId } = await auth();
  if (!userId) return null; // middleware redirects

  // For E.2 we hard-code an empty list; A.1's SpecGraphRepo provides .listForUser in a future task.
  const projects: Array<{ id: string; name: string }> = [];

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Your projects</h1>
      <p className="mt-2 text-sm text-slate-600">Visualize → Agree → Build</p>
      <div className="mt-6">
        <Link href="/projects/new" className="rounded-md bg-slate-900 px-4 py-2 text-white">+ New project</Link>
      </div>
      {projects.length === 0 ? (
        <p className="mt-8 text-slate-500">No projects yet. Click &quot;New project&quot; to start.</p>
      ) : (
        <ul className="mt-8 space-y-2">
          {projects.map((p) => (
            <li key={p.id}><Link href={`/projects/${p.id}`} className="underline">{p.name}</Link></li>
          ))}
        </ul>
      )}
    </main>
  );
}
