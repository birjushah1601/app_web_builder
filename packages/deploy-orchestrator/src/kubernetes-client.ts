export interface KubernetesClient {
  apply(namespace: string, kind: string, name: string, manifestYaml: string): Promise<void>;
  delete(namespace: string, kind: string, name: string): Promise<void>;
  /** Read the live status of an Argo CD Application as `Healthy` | `Progressing` | `Degraded` | `Missing` | `Unknown`. */
  argoApplicationHealth(name: string): Promise<string>;
}

export class InMemoryKubernetesClient implements KubernetesClient {
  private readonly store = new Map<string, string>();
  private readonly health = new Map<string, string>();

  async apply(namespace: string, kind: string, name: string, manifestYaml: string): Promise<void> {
    this.store.set(`${namespace}/${kind}/${name}`, manifestYaml);
    if (kind === "Application") this.health.set(name, "Healthy");
  }

  async delete(namespace: string, kind: string, name: string): Promise<void> {
    this.store.delete(`${namespace}/${kind}/${name}`);
    if (kind === "Application") this.health.delete(name);
  }

  async argoApplicationHealth(name: string): Promise<string> {
    return this.health.get(name) ?? "Missing";
  }

  get(namespace: string, kind: string, name: string): string | undefined {
    return this.store.get(`${namespace}/${kind}/${name}`);
  }

  setHealth(name: string, status: string): void {
    this.health.set(name, status);
  }
}
