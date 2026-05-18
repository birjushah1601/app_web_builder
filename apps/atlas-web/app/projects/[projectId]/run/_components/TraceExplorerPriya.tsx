import type { TraceLink } from "@atlas/run-dashboard";

export interface TraceExplorerPriyaProps {
  traces: TraceLink[];
  grafanaTraceUrlBase: string;
}

export function TraceExplorerPriya({ traces, grafanaTraceUrlBase }: TraceExplorerPriyaProps) {
  if (traces.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        No traces in this window.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="min-w-full divide-y divide-zinc-200 text-sm">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-4 py-2 text-left">Started</th>
            <th className="px-4 py-2 text-left">Endpoint</th>
            <th className="px-4 py-2 text-right">Duration</th>
            <th className="px-4 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {traces.map((t) => (
            <tr
              key={t.traceId}
              data-errored={t.errorOccurred ? "true" : "false"}
              className={t.errorOccurred ? "bg-red-50" : ""}
            >
              <td className="px-4 py-2">{t.startedAtIso}</td>
              <td className="px-4 py-2 font-mono">
                <a
                  href={`${grafanaTraceUrlBase}${t.traceId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 underline"
                >
                  {t.rootEndpoint}
                </a>
              </td>
              <td className="px-4 py-2 text-right">{t.durationMs}ms</td>
              <td className="px-4 py-2">{t.errorOccurred ? "error" : "ok"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
