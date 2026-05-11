import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { emitKnativeServiceManifest } from "../src/manifests/knative-service.js";
import type { DeployRequest } from "../src/types.js";

const baseReq: DeployRequest = {
  projectId: "11111111-1111-4111-8111-111111111111",
  branchId: "main",
  imageRef: "registry.atlas.app/projects/abc@sha256:" + "0".repeat(64),
  target: "production",
  subdomain: "abc",
  apex: "atlas.app",
  env: { DB_SCHEMA: "br_abcdef0123456789" }
};

describe("emitKnativeServiceManifest", () => {
  it("emits a Knative serving.knative.dev/v1 Service", () => {
    const manifest = emitKnativeServiceManifest(baseReq, { branchSchemaName: "br_abcdef0123456789" });
    const parsed = yaml.load(manifest) as Record<string, unknown>;
    expect(parsed.apiVersion).toBe("serving.knative.dev/v1");
    expect(parsed.kind).toBe("Service");
  });

  it("encodes container image as exact sha256 digest", () => {
    const manifest = emitKnativeServiceManifest(baseReq, { branchSchemaName: "br_abcdef0123456789" });
    expect(manifest).toContain("@sha256:" + "0".repeat(64));
  });

  it("sets DB_SCHEMA env from input", () => {
    const manifest = emitKnativeServiceManifest(baseReq, { branchSchemaName: "br_abcdef0123456789" });
    const parsed = yaml.load(manifest) as {
      spec: { template: { spec: { containers: Array<{ env: Array<{ name: string; value: string }> }> } } };
    };
    const env = parsed.spec.template.spec.containers[0]!.env;
    expect(env.find((e) => e.name === "DB_SCHEMA")?.value).toBe("br_abcdef0123456789");
  });

  it("sets minScale=1 for production target (no scale-to-zero)", () => {
    const manifest = emitKnativeServiceManifest(baseReq, { branchSchemaName: "br_x" });
    const parsed = yaml.load(manifest) as {
      spec: { template: { metadata: { annotations: Record<string, string> } } };
    };
    expect(parsed.spec.template.metadata.annotations["autoscaling.knative.dev/minScale"]).toBe("1");
  });

  it("sets minScale=0 for preview target (scale-to-zero)", () => {
    const manifest = emitKnativeServiceManifest(
      { ...baseReq, target: "preview" },
      { branchSchemaName: "br_x" }
    );
    const parsed = yaml.load(manifest) as {
      spec: { template: { metadata: { annotations: Record<string, string> } } };
    };
    expect(parsed.spec.template.metadata.annotations["autoscaling.knative.dev/minScale"]).toBe("0");
  });
});

describe("emitKnativeServiceManifest — GlitchTip injection", () => {
  it("injects SENTRY_DSN when glitchTipDsn is provided in opts", () => {
    const manifest = emitKnativeServiceManifest(baseReq, {
      branchSchemaName: "br_x",
      glitchTipDsn: "https://abc@glitchtip.atlas.app/1"
    });
    const parsed = yaml.load(manifest) as {
      spec: { template: { spec: { containers: Array<{ env: Array<{ name: string; value: string }> }> } } };
    };
    const env = parsed.spec.template.spec.containers[0]!.env;
    expect(env.find((e) => e.name === "SENTRY_DSN")?.value).toBe("https://abc@glitchtip.atlas.app/1");
  });

  it("does not inject SENTRY_DSN when glitchTipDsn absent", () => {
    const manifest = emitKnativeServiceManifest(baseReq, { branchSchemaName: "br_x" });
    expect(manifest).not.toContain("SENTRY_DSN");
  });
});
