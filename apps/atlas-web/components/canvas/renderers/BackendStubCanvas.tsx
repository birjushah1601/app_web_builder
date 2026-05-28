"use client";

export interface BackendStubCanvasProps {
  projectId?: string;
  previewUrl?: string;
}

export function BackendStubCanvas({ previewUrl }: BackendStubCanvasProps) {
  return (
    <div
      data-testid="backend-stub-canvas"
      className="flex h-full w-full items-center justify-center bg-slate-50 p-8 text-sm text-slate-700"
    >
      <div className="max-w-md rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Backend
        </div>
        <div className="mt-1 text-slate-900">
          {previewUrl ? (
            <>
              Backend running on <span className="font-mono">{previewUrl}</span>.
            </>
          ) : (
            <>Backend node is running.</>
          )}
        </div>
        <div className="mt-2 text-[11px] text-slate-500">
          Swagger UI + endpoint explorer land in Plan D.
        </div>
      </div>
    </div>
  );
}
