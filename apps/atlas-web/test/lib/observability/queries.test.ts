import { describe, it, expect } from "vitest";
import {
  AVAILABILITY_QUERY,
  OPEN_ALERTS_QUERY,
  ENDPOINT_LATENCY_QUERY,
  ERROR_TRACES_QUERY
} from "@/lib/observability/queries";

describe("observability queries (Plan J Task 3)", () => {
  it("AVAILABILITY_QUERY references atlas_availability_ratio", () => {
    expect(AVAILABILITY_QUERY).toMatch(/atlas_availability_ratio/);
  });
  it("OPEN_ALERTS_QUERY references atlas_open_burn_alerts", () => {
    expect(OPEN_ALERTS_QUERY).toMatch(/atlas_open_burn_alerts/);
  });
  it("ENDPOINT_LATENCY_QUERY references atlas_http_request_duration_seconds_bucket", () => {
    expect(ENDPOINT_LATENCY_QUERY).toMatch(/atlas_http_request_duration_seconds_bucket/);
  });
  it("ERROR_TRACES_QUERY references trace_id label", () => {
    expect(ERROR_TRACES_QUERY).toMatch(/trace_id/);
  });
});
