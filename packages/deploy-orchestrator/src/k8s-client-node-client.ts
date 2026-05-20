import yaml from "js-yaml";
import { KubernetesApplyError } from "./errors.js";
import type { KubernetesClient } from "./kubernetes-client.js";

/**
 * Subset of @kubernetes/client-node's CustomObjectsApi we depend on — kept as
 * a structural interface so tests can inject a plain object without pulling in
 * the full SDK. Production callers pass `new CustomObjectsApi(kc)`.
 */
export interface K8sCustomObjectsApi {
  getNamespacedCustomObject(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    name: string
  ): Promise<{ body: unknown } | unknown>;
  createNamespacedCustomObject(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    body: unknown
  ): Promise<unknown>;
  patchNamespacedCustomObject(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    name: string,
    body: unknown,
    ..._rest: unknown[]
  ): Promise<unknown>;
  deleteNamespacedCustomObject(
    group: string,
    version: string,
    namespace: string,
    plural: string,
    name: string,
    ..._rest: unknown[]
  ): Promise<unknown>;
}

export interface K8sClientNodeClientOptions {
  api: K8sCustomObjectsApi;
}

interface ResourceRef {
  group: string;
  version: string;
  plural: string;
}

const RESOURCE_REFS: Record<string, ResourceRef> = {
  Service: { group: "serving.knative.dev", version: "v1", plural: "services" },
  Application: { group: "argoproj.io", version: "v1alpha1", plural: "applications" },
  Certificate: { group: "cert-manager.io", version: "v1", plural: "certificates" }
};

function resolveRef(kind: string): ResourceRef {
  const ref = RESOURCE_REFS[kind];
  if (!ref) throw new KubernetesApplyError(`unsupported kind "${kind}" — add to RESOURCE_REFS`);
  return ref;
}

function isHttp404(err: unknown): boolean {
  const anyErr = err as { statusCode?: number; response?: { statusCode?: number } };
  return anyErr?.statusCode === 404 || anyErr?.response?.statusCode === 404;
}

export class K8sClientNodeClient implements KubernetesClient {
  private readonly api: K8sCustomObjectsApi;

  constructor(opts: K8sClientNodeClientOptions) {
    this.api = opts.api;
  }

  async apply(namespace: string, kind: string, name: string, manifestYaml: string): Promise<void> {
    const { group, version, plural } = resolveRef(kind);
    const parsed = yaml.load(manifestYaml) as Record<string, unknown>;
    try {
      await this.api.getNamespacedCustomObject(group, version, namespace, plural, name);
      // Exists → PATCH using merge-patch+json semantics.
      await this.api.patchNamespacedCustomObject(
        group,
        version,
        namespace,
        plural,
        name,
        parsed,
        undefined,
        undefined,
        undefined,
        { headers: { "content-type": "application/merge-patch+json" } }
      );
    } catch (err) {
      if (isHttp404(err)) {
        try {
          await this.api.createNamespacedCustomObject(group, version, namespace, plural, parsed);
          return;
        } catch (createErr) {
          throw new KubernetesApplyError(
            `create ${kind}/${name} in ${namespace} failed`,
            { cause: createErr }
          );
        }
      }
      throw new KubernetesApplyError(
        `patch ${kind}/${name} in ${namespace} failed`,
        { cause: err }
      );
    }
  }

  async delete(namespace: string, kind: string, name: string): Promise<void> {
    const { group, version, plural } = resolveRef(kind);
    try {
      await this.api.deleteNamespacedCustomObject(group, version, namespace, plural, name);
    } catch (err) {
      if (isHttp404(err)) return; // idempotent
      throw new KubernetesApplyError(
        `delete ${kind}/${name} in ${namespace} failed`,
        { cause: err }
      );
    }
  }

  async argoApplicationHealth(name: string): Promise<string> {
    try {
      const res = await this.api.getNamespacedCustomObject(
        "argoproj.io",
        "v1alpha1",
        "argocd",
        "applications",
        name
      );
      // @kubernetes/client-node v1.x returns the body directly; older versions return { body }.
      const body = (res as { body?: unknown })?.body ?? res;
      const status = (body as { status?: { health?: { status?: string } } })?.status?.health?.status;
      return status ?? "Unknown";
    } catch (err) {
      if (isHttp404(err)) return "Missing";
      throw new KubernetesApplyError(
        `read Argo Application ${name} health failed`,
        { cause: err }
      );
    }
  }
}
