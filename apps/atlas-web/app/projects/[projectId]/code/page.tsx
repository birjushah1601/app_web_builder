export default async function CodePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <main className="p-6">
      <h2 className="text-lg font-semibold">Code view</h2>
      <p className="mt-2 text-sm text-slate-600">Project <code>{projectId}</code></p>
      <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
        Monaco editor + file tree + PR pane land with Plan E.3.
      </p>
    </main>
  );
}
