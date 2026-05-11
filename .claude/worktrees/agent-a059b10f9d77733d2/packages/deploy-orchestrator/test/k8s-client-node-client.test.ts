import { describe, it, expect, vi } from "vitest";
import yaml from "js-yaml";
import { K8sClientNodeClient, type K8sCustomObjectsApi } from "../src/k8s-client-node-client.js";
import { KubernetesApplyError } from "../src/errors.js";

function http404(): Error & { statusCode: number } {
  const err = new Error("HTTP 404") as Error & { statusCode: number };
  err.statusCode = 404;
  return err;
}
function http500(): Error & { statusCode: number } {
  const err = new Error("HTTP 500") as Error & { statusCode: number };
  err.statusCode = 500;
  return err;
}

function makeApi(overrides: Partial<K8sCustomObjectsApi> = {}): {
  api: K8sCustomObjectsApi;
  get: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn();
  const create = vi.fn();
  const patch = vi.fn();
  const del = vi.fn();
  const api: K8sCustomObjectsApi = {
    getNamespacedCustomObject: overrides.getNamespacedCustomObject ?? (get as never),
    createNamespacedCustomObject: overrides.createNamespacedCustomObject ?? (create as never),
    patchNamespacedCustomObject: overrides.patchNamespacedCustomObject ?? (patch as never),
    deleteNamespacedCustomObject: overrides.deleteNamespacedCustomObject ?? (del as never)
  };
  return { api, get, create, patch, del };
}

const knativeYaml = yaml.dump({
  apiVersion: "serving.knative.dev/v1",
  kind: "Service",
  metadata: { name: "p-abc-main", namespace: "atlas-projects" },
  spec: { template: { spec: { containers: [{ image: "x@sha256:" + "0".repeat(64) }] } } }
});

describe("K8sClientNodeClient.apply", () => {
  it("patches when the resource already exists", async () => {
    const { api, get, patch, create } = makeApi();
    get.mockResolvedValueOnce({ body: { metadata: { name: "p-abc-main" } } });
    patch.mockResolvedValueOnce({});
    const c = new K8sClientNodeClient({ api });
    await c.apply("atlas-projects", "Service", "p-abc-main", knativeYaml);
    expect(get).toHaveBeenCalledWith(
      "serving.knative.dev",
      "v1",
      "atlas-projects",
      "services",
      "p-abc-main"
    );
    expect(patch).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates when the resource does not exist (GET 404)", async () => {
    const { api, get, create, patch } = makeApi();
    get.mockRejectedValueOnce(http404());
    create.mockResolvedValueOnce({});
    const c = new K8sClientNodeClient({ api });
    await c.apply("atlas-projects", "Service", "p-abc-main", knativeYaml);
    expect(create).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
  });

  it("wraps underlying errors in KubernetesApplyError", async () => {
    const { api, get } = makeApi();
    get.mockRejectedValueOnce(http500());
    const c = new K8sClientNodeClient({ api });
    await expect(c.apply("atlas-projects", "Service", "n", knativeYaml)).rejects.toThrow(
      KubernetesApplyError
    );
  });

  it("resolves kind→(group,version,plural) for Application, Certificate, Service", async () => {
    const { api, get, patch } = makeApi();
    get.mockResolvedValue({ body: {} });
    patch.mockResolvedValue({});
    const c = new K8sClientNodeClient({ api });

    await c.apply("argocd", "Application", "n", yaml.dump({ metadata: { name: "n" } }));
    expect(get).toHaveBeenLastCalledWith("argoproj.io", "v1alpha1", "argocd", "applications", "n");

    await c.apply(
      "atlas-projects",
      "Certificate",
      "n",
      yaml.dump({ metadata: { name: "n" } })
    );
    expect(get).toHaveBeenLastCalledWith(
      "cert-manager.io",
      "v1",
      "atlas-projects",
      "certificates",
      "n"
    );
  });

  it("throws KubernetesApplyError for unsupported kinds", async () => {
    const { api } = makeApi();
    const c = new K8sClientNodeClient({ api });
    await expect(c.apply("ns", "ConfigMap", "n", yaml.dump({}))).rejects.toThrow(/unsupported kind/);
  });
});

describe("K8sClientNodeClient.delete", () => {
  it("calls deleteNamespacedCustomObject with the resolved ref", async () => {
    const { api, del } = makeApi();
    del.mockResolvedValueOnce({});
    const c = new K8sClientNodeClient({ api });
    await c.delete("argocd", "Application", "p-abc-main");
    expect(del).toHaveBeenCalledWith(
      "argoproj.io",
      "v1alpha1",
      "argocd",
      "applications",
      "p-abc-main"
    );
  });

  it("is idempotent — swallows 404", async () => {
    const { api, del } = makeApi();
    del.mockRejectedValueOnce(http404());
    const c = new K8sClientNodeClient({ api });
    await expect(c.delete("argocd", "Application", "gone")).resolves.toBeUndefined();
  });

  it("wraps non-404 errors", async () => {
    const { api, del } = makeApi();
    del.mockRejectedValueOnce(http500());
    const c = new K8sClientNodeClient({ api });
    await expect(c.delete("argocd", "Application", "x")).rejects.toThrow(KubernetesApplyError);
  });
});

describe("K8sClientNodeClient.argoApplicationHealth", () => {
  it("reads .status.health.status from Argo Application body", async () => {
    const { api, get } = makeApi();
    get.mockResolvedValueOnce({
      body: { status: { health: { status: "Healthy" } } }
    });
    const c = new K8sClientNodeClient({ api });
    expect(await c.argoApplicationHealth("p-abc-main")).toBe("Healthy");
  });

  it("returns Missing on 404", async () => {
    const { api, get } = makeApi();
    get.mockRejectedValueOnce(http404());
    const c = new K8sClientNodeClient({ api });
    expect(await c.argoApplicationHealth("gone")).toBe("Missing");
  });

  it("returns Unknown when .status.health is absent", async () => {
    const { api, get } = makeApi();
    get.mockResolvedValueOnce({ body: {} });
    const c = new K8sClientNodeClient({ api });
    expect(await c.argoApplicationHealth("x")).toBe("Unknown");
  });

  it("handles client-node v1 shape (body returned directly, no .body wrapper)", async () => {
    const { api, get } = makeApi();
    get.mockResolvedValueOnce({ status: { health: { status: "Progressing" } } });
    const c = new K8sClientNodeClient({ api });
    expect(await c.argoApplicationHealth("x")).toBe("Progressing");
  });
});
