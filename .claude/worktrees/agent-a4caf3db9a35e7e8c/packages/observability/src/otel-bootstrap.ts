import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { Resource } from "@opentelemetry/resources";
import { buildAtlasResourceAttributes } from "./traceAttributes.js";

export interface OtelInitOptions {
  serviceName: string;
  serviceVersion: string;
  deployTarget: "production" | "preview";
  /** "noop" for tests; "otlp-proto" for real deploys. */
  exporterMode: "noop" | "otlp-proto";
}

let sdk: NodeSDK | null = null;

export async function initOtelSdk(opts: OtelInitOptions): Promise<void> {
  if (sdk) return;
  const resource = new Resource(
    buildAtlasResourceAttributes({
      serviceName: opts.serviceName,
      serviceVersion: opts.serviceVersion,
      deployTarget: opts.deployTarget
    })
  );
  const traceExporter =
    opts.exporterMode === "otlp-proto"
      ? new OTLPTraceExporter({
          url: `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://otel-collector:4318"}/v1/traces`
        })
      : undefined;
  sdk = new NodeSDK({ resource, traceExporter });
  sdk.start();
}

export async function shutdownOtelSdk(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = null;
}
