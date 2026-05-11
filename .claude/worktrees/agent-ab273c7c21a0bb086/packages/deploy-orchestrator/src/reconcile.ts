import type { KubernetesClient } from "./kubernetes-client.js";
import { ReconcileTimeoutError } from "./errors.js";

const SETTLED = new Set(["Healthy", "Degraded"]);

export interface ReconcileOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

export async function reconcileArgoUntilSettled(
  k8s: KubernetesClient,
  applicationName: string,
  options: ReconcileOptions = {}
): Promise<string> {
  const intervalMs = options.intervalMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const start = Date.now();
  while (true) {
    const health = await k8s.argoApplicationHealth(applicationName);
    if (SETTLED.has(health)) return health;
    if (Date.now() - start > timeoutMs) {
      throw new ReconcileTimeoutError(applicationName, Date.now() - start);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
