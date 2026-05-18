import { HttpGrafanaClient } from "@atlas/run-dashboard";
import { isFeatureEnabled } from "@/lib/feature-flags";

const warnedAbout = new Set<string>();
function warnOnce(key: string, msg: string): void {
  if (warnedAbout.has(key)) return;
  warnedAbout.add(key);
  console.warn(`[atlas-web/observability] ${msg}`);
}

/**
 * Construct a real Grafana HTTP client gated on the run-grafana feature
 * flag AND presence of both ATLAS_GRAFANA_URL + ATLAS_GRAFANA_TOKEN env
 * vars. Returns undefined when any prerequisite is missing — callers
 * should treat undefined as "telemetry not available; render placeholder".
 *
 * Each missing-env case logs a one-shot warn so operators see WHY
 * telemetry isn't wiring without flooding logs.
 */
export function getGrafanaClient(): HttpGrafanaClient | undefined {
  if (!isFeatureEnabled("run-grafana")) return undefined;
  const baseUrl = process.env.ATLAS_GRAFANA_URL;
  const token = process.env.ATLAS_GRAFANA_TOKEN;
  if (!baseUrl) {
    warnOnce("missing-url", "ATLAS_FF_RUN_GRAFANA is on but ATLAS_GRAFANA_URL is unset; Run page will render placeholder");
    return undefined;
  }
  if (!token) {
    warnOnce("missing-token", "ATLAS_FF_RUN_GRAFANA is on but ATLAS_GRAFANA_TOKEN is unset; Run page will render placeholder");
    return undefined;
  }
  return new HttpGrafanaClient({ baseUrl, token });
}
