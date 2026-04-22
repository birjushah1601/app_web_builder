import type { HealthSummary } from "@atlas/run-dashboard";

const COPY: Record<HealthSummary["light"], { headline: string; sub: string }> = {
  green: { headline: "All systems normal", sub: "Your app is healthy." },
  amber: {
    headline: "Needs attention",
    sub: "A degradation is in progress — your developer should investigate."
  },
  red: {
    headline: "Urgent — your app is unhealthy",
    sub: "Users are affected. Page your on-call."
  },
  unknown: {
    headline: "No data yet",
    sub: "Telemetry has not arrived yet — check back in a few minutes."
  }
};

const COLORS: Record<HealthSummary["light"], string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-600",
  unknown: "bg-zinc-400"
};

export function HealthLightsAma({ summary }: { summary: HealthSummary }) {
  const copy = COPY[summary.light];
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6">
      <div className="flex items-center gap-4">
        <div
          data-testid="health-light"
          data-light={summary.light}
          className={`h-16 w-16 rounded-full ${COLORS[summary.light]}`}
        />
        <div>
          <h2 className="text-xl font-semibold text-zinc-900">{copy.headline}</h2>
          <p className="text-sm text-zinc-600">{copy.sub}</p>
        </div>
      </div>
    </div>
  );
}
