import { Registry, collectDefaultMetrics } from "prom-client";

export interface PromInitOptions {
  serviceName: string;
  serviceVersion: string;
}

let registry: Registry | null = null;

export function initPromRegistry(opts: PromInitOptions): Registry {
  if (registry) return registry;
  registry = new Registry();
  registry.setDefaultLabels({
    service: opts.serviceName,
    version: opts.serviceVersion
  });
  collectDefaultMetrics({ register: registry });
  return registry;
}

export function getPromRegistry(): Registry {
  if (!registry) throw new Error("initPromRegistry must be called before getPromRegistry");
  return registry;
}

/** Test helper. Production code should never call this. */
export function resetPromRegistry(): void {
  registry = null;
}
