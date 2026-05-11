import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { emitArgoApplicationManifest, argoApplicationName } from "../src/manifests/argo-application.js";
import type { DeployRequest } from "../src/types.js";

const baseReq: DeployRequest = {
  projectId: "11111111-1111-4111-8111-111111111111",
  branchId: "main",
  imageRef: "registry.atlas.app/projects/abc@sha256:" + "0".repeat(64),
  target: "production",
  subdomain: "abc",
  apex: "atlas.app",
  env: {}
};

describe("emitArgoApplicationManifest", () => {
  it("emits an argoproj.io/v1alpha1 Application", () => {
    const manifest = emitArgoApplicationManifest(baseReq, {
      manifestRepoUrl: "https://gitea.atlas.app/atlas/deployments.git",
      manifestPath: "projects/abc/main"
    });
    const parsed = yaml.load(manifest) as Record<string, unknown>;
    expect(parsed.apiVersion).toBe("argoproj.io/v1alpha1");
    expect(parsed.kind).toBe("Application");
  });

  it("targets the destination namespace atlas-projects", () => {
    const manifest = emitArgoApplicationManifest(baseReq, {
      manifestRepoUrl: "git@example",
      manifestPath: "x"
    });
    const parsed = yaml.load(manifest) as { spec: { destination: { namespace: string } } };
    expect(parsed.spec.destination.namespace).toBe("atlas-projects");
  });

  it("uses the documented application name shape", () => {
    expect(argoApplicationName(baseReq)).toBe("p-abc-main");
  });

  it("sets automated sync with prune + selfHeal", () => {
    const manifest = emitArgoApplicationManifest(baseReq, {
      manifestRepoUrl: "x",
      manifestPath: "x"
    });
    const parsed = yaml.load(manifest) as {
      spec: { syncPolicy: { automated: { prune: boolean; selfHeal: boolean } } };
    };
    expect(parsed.spec.syncPolicy.automated.prune).toBe(true);
    expect(parsed.spec.syncPolicy.automated.selfHeal).toBe(true);
  });
});
