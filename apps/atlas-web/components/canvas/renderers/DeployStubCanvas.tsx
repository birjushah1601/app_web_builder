"use client";

export function DeployStubCanvas() {
  return (
    <div
      data-testid="deploy-stub-canvas"
      className="flex h-full w-full items-center justify-center bg-slate-50 p-8 text-sm text-slate-700"
    >
      <div className="max-w-md rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Deploy
        </div>
        <div className="mt-1 text-slate-900">
          Deploy node staged.
        </div>
        <div className="mt-2 text-[11px] text-slate-500">
          Live deploy status panel lands in Plan F.
        </div>
      </div>
    </div>
  );
}
