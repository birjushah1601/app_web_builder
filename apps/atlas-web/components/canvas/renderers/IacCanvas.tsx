"use client";

import { useState } from "react";
import type { IacArtifact } from "@atlas/workflow-engine";

export interface IacCanvasProps {
  artifact?: IacArtifact;
}

export function IacCanvas({ artifact }: IacCanvasProps) {
  const [openManifests, setOpenManifests] = useState<Record<string, boolean>>({});

  if (!artifact) {
    return (
      <div
        data-testid="iac-canvas-empty"
        className="flex h-full w-full items-center justify-center bg-slate-50 p-8 text-sm text-slate-700"
      >
        IaC artifact not yet available. Waiting for the iac ritual to finish…
      </div>
    );
  }

  const toggle = (name: string) =>
    setOpenManifests((cur) => ({ ...cur, [name]: !cur[name] }));

  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-slate-50">
      <section className="border-b border-slate-200 bg-white">
        <header className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
          Services ({artifact.services.length})
        </header>
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-1 font-medium">Name</th>
              <th className="px-3 py-1 font-medium">Kind</th>
              <th className="px-3 py-1 font-medium">Port</th>
              <th className="px-3 py-1 font-medium">Env vars</th>
            </tr>
          </thead>
          <tbody>
            {artifact.services.map((s) => (
              <tr
                key={s.name}
                data-testid={`iac-services-row-${s.name}`}
                className="border-t border-slate-100"
              >
                <td className="px-3 py-1 font-mono text-slate-800">{s.name}</td>
                <td className="px-3 py-1 font-mono text-[11px] text-slate-600">{s.artifactKind}</td>
                <td className="px-3 py-1 text-slate-700">{s.port ?? "—"}</td>
                <td className="px-3 py-1 text-slate-500">{s.envContract.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="border-b border-slate-200 bg-white">
        <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
          <span>{artifact.compose.file}</span>
          <span className="font-normal text-slate-500">docker-compose</span>
        </header>
        <pre
          data-testid="iac-compose-content"
          className="overflow-x-auto bg-slate-900 px-3 py-2 font-mono text-[11px] text-slate-100"
        >
          {artifact.compose.content}
        </pre>
      </section>

      <section className="bg-white">
        <header className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
          K8s manifests ({artifact.k8s.manifests.length})
        </header>
        <ul>
          {artifact.k8s.manifests.map((m) => (
            <li
              key={m.name}
              data-testid={`iac-manifest-row-${m.name}`}
              className="border-t border-slate-100"
            >
              <div className="flex items-center gap-3 px-3 py-1 text-xs">
                <span className="font-mono text-slate-800">{m.name}</span>
                <span className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-700">
                  {m.kind}
                </span>
                <span className="font-mono text-[11px] text-slate-500">{m.file}</span>
                <button
                  type="button"
                  data-testid={`iac-manifest-toggle-${m.name}`}
                  onClick={() => toggle(m.name)}
                  className="ml-auto rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] hover:bg-slate-50"
                >
                  {openManifests[m.name] ? "hide" : "view"}
                </button>
              </div>
              {openManifests[m.name] && (
                <pre
                  data-testid={`iac-manifest-content-${m.name}`}
                  className="overflow-x-auto bg-slate-900 px-3 py-2 font-mono text-[11px] text-slate-100"
                >
                  {m.content}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
