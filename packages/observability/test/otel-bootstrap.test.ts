import { describe, it, expect, afterEach } from "vitest";
import { initOtelSdk, shutdownOtelSdk } from "../src/otel-bootstrap.js";

describe("initOtelSdk", () => {
  afterEach(async () => {
    await shutdownOtelSdk();
  });

  it("starts the SDK in noop mode and shuts down cleanly", async () => {
    await initOtelSdk({
      serviceName: "atlas-test",
      serviceVersion: "0.0.0",
      deployTarget: "production",
      exporterMode: "noop"
    });
    await expect(shutdownOtelSdk()).resolves.toBeUndefined();
  });

  it("is idempotent — second init is a no-op", async () => {
    await initOtelSdk({
      serviceName: "x",
      serviceVersion: "0",
      deployTarget: "preview",
      exporterMode: "noop"
    });
    await initOtelSdk({
      serviceName: "x",
      serviceVersion: "0",
      deployTarget: "preview",
      exporterMode: "noop"
    });
  });

  it("accepts the otlp-proto exporterMode without throwing at init time", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel-collector:4318";
    await initOtelSdk({
      serviceName: "x",
      serviceVersion: "0",
      deployTarget: "production",
      exporterMode: "otlp-proto"
    });
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(true).toBe(true);
  });

  it("shutdown is a no-op when nothing was initialized", async () => {
    await expect(shutdownOtelSdk()).resolves.toBeUndefined();
  });
});
