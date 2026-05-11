import { describe, it, expect } from "vitest";
import { InMemoryKubernetesClient } from "../src/kubernetes-client.js";

describe("InMemoryKubernetesClient", () => {
  it("apply records the manifest under (namespace, kind, name)", async () => {
    const c = new InMemoryKubernetesClient();
    await c.apply("argocd", "Application", "p-abc-main", "yaml-text");
    expect(c.get("argocd", "Application", "p-abc-main")).toBe("yaml-text");
  });

  it("delete removes the recorded manifest", async () => {
    const c = new InMemoryKubernetesClient();
    await c.apply("ns", "K", "n", "y");
    await c.delete("ns", "K", "n");
    expect(c.get("ns", "K", "n")).toBeUndefined();
  });

  it("argoApplicationHealth returns Healthy after apply for Application kind", async () => {
    const c = new InMemoryKubernetesClient();
    await c.apply("argocd", "Application", "x", "y");
    expect(await c.argoApplicationHealth("x")).toBe("Healthy");
  });

  it("argoApplicationHealth returns Missing when nothing applied", async () => {
    const c = new InMemoryKubernetesClient();
    expect(await c.argoApplicationHealth("x")).toBe("Missing");
  });
});
