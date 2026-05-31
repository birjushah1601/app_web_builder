import { describe, it, expect, vi } from "vitest";
import { IacRole } from "../src/role.js";

const VALID_COMPOSE = "version: '3'\nservices:\n  api: {}";
const VALID_K8S = [{ file: "k8s/api.yaml", kind: "Knative Service", name: "api", content: "kind: Service" }];

describe("IacRole", () => {
  it("emits a ritual.artifact_emitted event with a valid IacArtifact", async () => {
    const generateIac = vi.fn(async () => ({ composeYaml: VALID_COMPOSE, k8sManifests: VALID_K8S }));
    const role = new IacRole({ generateIac });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "",
      priorArtifact: {
        upstream: {
          backend: { schemaVersion: "1", kind: "backend-rest-api", openApiSpec: {}, routes: [], envContract: [{ name: "DB", required: true }], sandboxId: "sb-1" }
        }
      }
    });
    const ev = out.events.find((e) => e.eventType === "ritual.artifact_emitted");
    expect(ev).toBeDefined();
    const artifact = (ev?.payload as { artifact: { kind: string; services: Array<{ runtimeNodeId: string }>; k8s: { manifests: unknown[] } } }).artifact;
    expect(artifact.kind).toBe("iac");
    expect(artifact.services).toHaveLength(1);
    expect(artifact.services[0]?.runtimeNodeId).toBe("backend");
    expect(generateIac).toHaveBeenCalledOnce();
  });

  it("emits iac.failed when no upstream runtime artifacts exist", async () => {
    const role = new IacRole({ generateIac: vi.fn() });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "",
      priorArtifact: { upstream: {} }
    });
    expect(out.events.some((e) => e.eventType === "iac.failed")).toBe(true);
    expect(out.events.some((e) => e.eventType === "ritual.artifact_emitted")).toBe(false);
  });

  it("emits iac.failed when generateIac throws", async () => {
    const generateIac = vi.fn(async () => { throw new Error("LLM unavailable"); });
    const role = new IacRole({ generateIac });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "",
      priorArtifact: {
        upstream: { backend: { schemaVersion: "1", kind: "backend-rest-api", openApiSpec: {}, routes: [], envContract: [], sandboxId: "sb-1" } }
      }
    });
    expect(out.events.some((e) => e.eventType === "iac.failed")).toBe(true);
  });

  it("tolerates lint failure and still emits the artifact", async () => {
    const generateIac = vi.fn(async () => ({ composeYaml: VALID_COMPOSE, k8sManifests: VALID_K8S }));
    const sandbox = {
      exec: vi.fn(async () => { throw new Error("docker not installed"); }),
      write: vi.fn()
    };
    const role = new IacRole({ generateIac, sandbox });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "",
      priorArtifact: {
        upstream: { backend: { schemaVersion: "1", kind: "backend-rest-api", openApiSpec: {}, routes: [], envContract: [], sandboxId: "sb-1" } }
      }
    });
    expect(out.events.some((e) => e.eventType === "ritual.artifact_emitted")).toBe(true);
  });

  it("ignores upstream nodes whose kind isn't a runtime kind", async () => {
    const generateIac = vi.fn(async () => ({ composeYaml: VALID_COMPOSE, k8sManifests: VALID_K8S }));
    const role = new IacRole({ generateIac });
    const out = await role.run({
      ritualId: "r-1", intent: "x", graphSlice: { bytes: "{}", hash: "h" }, userTurn: "",
      priorArtifact: {
        upstream: {
          backend: { schemaVersion: "1", kind: "backend-rest-api", openApiSpec: {}, routes: [], envContract: [], sandboxId: "sb-1" },
          tests: { schemaVersion: "1", kind: "tests", framework: "vitest", specs: [] }
        }
      }
    });
    const ev = out.events.find((e) => e.eventType === "ritual.artifact_emitted");
    const artifact = (ev?.payload as { artifact: { services: Array<{ runtimeNodeId: string }> } }).artifact;
    expect(artifact.services).toHaveLength(1);
    expect(artifact.services[0]?.runtimeNodeId).toBe("backend");
  });
});
