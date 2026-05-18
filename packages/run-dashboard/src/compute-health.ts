import type { GrafanaClient } from "./grafana-client.js";
import { HealthSummarySchema, type HealthSummary } from "./types.js";

export interface ComputeHealthInput {
  windowFromIso: string;
  windowToIso: string;
  availabilityQuery?: string;
  alertsQuery?: string;
}

export async function computeHealthSummary(
  grafana: GrafanaClient,
  input: ComputeHealthInput
): Promise<HealthSummary> {
  try {
    const [avail, alerts] = await Promise.all([
      grafana.queryInstant({ query: input.availabilityQuery ?? "atlas_availability_ratio" }),
      grafana.queryInstant({ query: input.alertsQuery ?? "atlas_open_burn_alerts" })
    ]);
    let light: HealthSummary["light"];
    if (avail.value < 0.99 || alerts.value >= 2) light = "red";
    else if (avail.value < 0.999 || alerts.value > 0) light = "amber";
    else light = "green";
    return HealthSummarySchema.parse({
      light,
      availabilityRatio: avail.value,
      openAlerts: Math.floor(alerts.value),
      windowFromIso: input.windowFromIso,
      windowToIso: input.windowToIso
    });
  } catch {
    return HealthSummarySchema.parse({
      light: "unknown",
      availabilityRatio: 0,
      openAlerts: 0,
      windowFromIso: input.windowFromIso,
      windowToIso: input.windowToIso
    });
  }
}
