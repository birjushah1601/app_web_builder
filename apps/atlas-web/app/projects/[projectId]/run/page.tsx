import { computeHealthSummary, type HealthSummary, type EndpointStat, type TraceLink } from "@atlas/run-dashboard";
import { HealthLightsAma } from "./_components/HealthLightsAma";
import { EndpointTableDiego } from "./_components/EndpointTableDiego";
import { TraceExplorerPriya } from "./_components/TraceExplorerPriya";
import { getGrafanaClient } from "@/lib/observability/grafana";
import { AVAILABILITY_QUERY, OPEN_ALERTS_QUERY } from "@/lib/observability/queries";

type Persona = "ama" | "diego" | "priya";

export default async function RunDashboardPage({
  params,
  searchParams
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ persona?: Persona }>;
}) {
  const { projectId } = await params;
  const { persona = "ama" } = await searchParams;

  // Plan J: when ATLAS_FF_RUN_GRAFANA + ATLAS_GRAFANA_URL + ATLAS_GRAFANA_TOKEN
  // are all set, query real telemetry. Otherwise render today's "unknown"
  // placeholder so the page stays renderable without ops setup.
  const grafana = getGrafanaClient();
  const windowToIso = new Date().toISOString();
  const windowFromIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  let summary: HealthSummary;
  if (grafana) {
    // computeHealthSummary already wraps a try/catch that returns
    // light: "unknown" on Grafana failure — runtime outage degrades like
    // flag-OFF without crashing the page.
    summary = await computeHealthSummary(grafana, {
      windowFromIso,
      windowToIso,
      availabilityQuery: AVAILABILITY_QUERY,
      alertsQuery: OPEN_ALERTS_QUERY
    });
  } else {
    summary = {
      light: "unknown",
      availabilityRatio: 0,
      openAlerts: 0,
      windowFromIso,
      windowToIso
    };
  }

  // Endpoint stats + trace links are deferred to a follow-up plan —
  // computeEndpointStats() takes pre-parsed metric maps (not a GrafanaClient),
  // so wiring it requires multiple separate queries + parsing. v1 leaves
  // these empty arrays so Diego and Priya panels render without data.
  const endpointStats: EndpointStat[] = [];
  const traces: TraceLink[] = [];

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900">
          Run · <span className="font-mono text-base text-zinc-600">{projectId}</span>
        </h1>
        <PersonaSwitcher current={persona} projectId={projectId} />
      </header>
      <section className="space-y-6">
        {persona === "ama" && <HealthLightsAma summary={summary} />}
        {persona === "diego" && (
          <>
            <HealthLightsAma summary={summary} />
            <EndpointTableDiego stats={endpointStats} />
          </>
        )}
        {persona === "priya" && (
          <>
            <HealthLightsAma summary={summary} />
            <EndpointTableDiego stats={endpointStats} />
            <TraceExplorerPriya
              traces={traces}
              grafanaTraceUrlBase={
                process.env.GRAFANA_TRACE_URL_BASE ??
                "https://grafana.atlas.app/explore?orgId=1&traceId="
              }
            />
          </>
        )}
      </section>
    </main>
  );
}

function PersonaSwitcher({ current, projectId }: { current: string; projectId: string }) {
  const personas: Persona[] = ["ama", "diego", "priya"];
  return (
    <nav className="mt-2 flex gap-2 text-xs">
      {personas.map((p) => (
        <a
          key={p}
          href={`/projects/${projectId}/run?persona=${p}`}
          className={`rounded px-2 py-1 ${
            current === p ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700"
          }`}
        >
          {p}
        </a>
      ))}
    </nav>
  );
}
