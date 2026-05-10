import { createProject } from "./actions";

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
