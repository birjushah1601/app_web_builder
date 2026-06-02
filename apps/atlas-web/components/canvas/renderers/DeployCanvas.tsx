"use client";

import type { DeployArtifact, DeployResult } from "@atlas/workflow-engine";

export interface DeployCanvasProps {
  artifact?: DeployArtifact;
  /** Plan F.2 — populated by the workflow engine when the deploy runtime
   *  hook actually applied the artifact's manifests. When present, the
   *  canvas surfaces a "Deployed" / "Deploy failed" header with the live
   *  publicUrl + Argo Application name + applied-manifest count, and
   *  hides the F.2-future banner. The existing artifact-driven sections
   *  (Argo summary, image builds, smoke tests) still render below as
   *  context, since the deployResult only carries identifiers — not the
   *  full plan the artifact describes. */
  deployResult?: DeployResult;
}

export function DeployCanvas({ artifact, deployResult }: DeployCanvasProps) {
  if (!artifact) {
    return (
      <div
        data-testid="deploy-canvas-empty"
        className="flex h-full w-full items-center justify-center bg-slate-50 p-8 text-sm text-slate-700"
      >
        Deploy artifact not yet available. Waiting for the deployer ritual to finish…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-slate-50">
      {deployResult && (
        <section
          data-testid="deploy-runtime-header"
          className={`border-b border-slate-200 px-3 py-3 ${
            deployResult.phase === "healthy"
              ? "bg-emerald-50 text-emerald-900"
              : "bg-red-50 text-red-900"
          }`}
        >
          <div className="text-xs font-semibold uppercase tracking-wide">
            {deployResult.phase === "healthy" ? "Deployed" : "Deploy failed"}
          </div>
          <a
            data-testid="deploy-runtime-publicurl"
            href={deployResult.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block font-mono text-sm underline hover:no-underline"
          >
            {deployResult.publicUrl}
          </a>
          <div className="mt-1 text-[11px]">
            Argo: <span className="font-mono">{deployResult.argoApplicationName}</span>
            {" · "}
            {deployResult.appliedManifests.length} applied
          </div>
        </section>
      )}

      <section className="border-b border-slate-200 bg-white">
        <header className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
          Argo CD Application
        </header>
        <dl
          data-testid="deploy-argo-summary"
          className="grid grid-cols-[120px_1fr] gap-y-1 px-3 py-2 text-xs"
        >
          <dt className="text-slate-500">Name</dt>
          <dd className="font-mono text-slate-800">{artifact.argoApplication.name}</dd>
          <dt className="text-slate-500">Repo URL</dt>
          <dd className="font-mono text-slate-800">{artifact.argoApplication.repoUrl}</dd>
          <dt className="text-slate-500">Path</dt>
          <dd className="font-mono text-slate-800">{artifact.argoApplication.path}</dd>
          <dt className="text-slate-500">File</dt>
          <dd className="font-mono text-slate-800">{artifact.argoApplication.file}</dd>
        </dl>
      </section>

      <section className="border-b border-slate-200 bg-white">
        <header className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
          Image builds ({artifact.imageBuilds.length})
        </header>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-1 font-medium">Service</th>
              <th className="px-3 py-1 font-medium">Dockerfile</th>
              <th className="px-3 py-1 font-medium">Image tag</th>
            </tr>
          </thead>
          <tbody>
            {artifact.imageBuilds.map((b) => (
              <tr
                key={b.serviceName}
                data-testid={`deploy-image-row-${b.serviceName}`}
                className="border-t border-slate-100"
              >
                <td className="px-3 py-1 font-mono text-slate-800">{b.serviceName}</td>
                <td className="px-3 py-1 font-mono text-[11px] text-slate-600">{b.dockerfilePath}</td>
                <td className="px-3 py-1 font-mono text-[11px] text-slate-600">{b.imageTag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="border-b border-slate-200 bg-white">
        <header className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
          Smoke tests ({artifact.smokeTests.length})
        </header>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-1 font-medium">URL</th>
              <th className="px-3 py-1 font-medium">Method</th>
              <th className="px-3 py-1 font-medium">Expect status</th>
              <th className="px-3 py-1 font-medium">Body contains</th>
            </tr>
          </thead>
          <tbody>
            {artifact.smokeTests.map((s) => (
              <tr
                key={s.url}
                data-testid={`deploy-smoke-row-${s.url}`}
                className="border-t border-slate-100"
              >
                <td className="px-3 py-1 font-mono text-slate-800">{s.url}</td>
                <td className="px-3 py-1 text-[11px] uppercase text-slate-600">{s.method ?? "get"}</td>
                <td className="px-3 py-1 text-slate-700">{s.expectStatus}</td>
                <td className="px-3 py-1 font-mono text-[11px] text-slate-500">{s.expectBodyContains ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {!deployResult && (
        <footer
          data-testid="deploy-future-banner"
          className="border-t border-slate-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
        >
          Actual deploy execution (Argo sync, image push, smoke runs) lands in Plan F.2. This panel is read-only.
        </footer>
      )}
    </div>
  );
}
