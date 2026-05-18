import type { EndpointStat } from "@atlas/run-dashboard";

export function EndpointTableDiego({ stats }: { stats: EndpointStat[] }) {
  if (stats.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        No endpoint traffic in this window.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="min-w-full divide-y divide-zinc-200 text-sm">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-4 py-2 text-left">Endpoint</th>
            <th className="px-4 py-2 text-right">Requests</th>
            <th className="px-4 py-2 text-right">Errors</th>
            <th className="px-4 py-2 text-right">p50</th>
            <th className="px-4 py-2 text-right">p95</th>
            <th className="px-4 py-2 text-right">p99</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {stats.map((s) => {
            const errorRate = s.requestCount > 0 ? s.errorCount / s.requestCount : 0;
            const highlight = errorRate >= 0.01;
            return (
              <tr
                key={s.endpointId}
                data-highlight={highlight ? "true" : "false"}
                className={highlight ? "bg-red-50" : ""}
              >
                <td className="px-4 py-2 font-mono">{s.endpointId}</td>
                <td className="px-4 py-2 text-right">{s.requestCount}</td>
                <td className="px-4 py-2 text-right">{s.errorCount}</td>
                <td className="px-4 py-2 text-right">{s.p50Ms}ms</td>
                <td className="px-4 py-2 text-right">{s.p95Ms}ms</td>
                <td className="px-4 py-2 text-right">{s.p99Ms}ms</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
