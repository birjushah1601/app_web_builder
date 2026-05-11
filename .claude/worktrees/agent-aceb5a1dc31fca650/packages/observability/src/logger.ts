import { context, trace } from "@opentelemetry/api";
import pino from "pino";

export interface AtlasLoggerOptions {
  serviceName: string;
  level?: pino.Level;
}

export function createAtlasLogger(opts: AtlasLoggerOptions): pino.Logger {
  return pino({
    level: opts.level ?? "info",
    base: { service: opts.serviceName },
    formatters: {
      log(obj) {
        const span = trace.getSpan(context.active());
        if (span) {
          const ctx = span.spanContext();
          return { ...obj, trace_id: ctx.traceId, span_id: ctx.spanId };
        }
        return obj;
      }
    }
  });
}
