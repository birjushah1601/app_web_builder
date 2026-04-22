import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { emitCertificateManifest } from "../src/manifests/cert-manager-cert.js";
import type { DeployRequest } from "../src/types.js";

const baseReq: DeployRequest = {
  projectId: "11111111-1111-4111-8111-111111111111",
  branchId: "main",
  imageRef: "x@sha256:" + "0".repeat(64),
  target: "production",
  subdomain: "abc",
  apex: "atlas.app",
  env: {}
};

describe("emitCertificateManifest", () => {
  it("emits a cert-manager.io/v1 Certificate", () => {
    const manifest = emitCertificateManifest(baseReq, { issuerRef: "letsencrypt-cloudflare-dns01" });
    const parsed = yaml.load(manifest) as Record<string, unknown>;
    expect(parsed.apiVersion).toBe("cert-manager.io/v1");
    expect(parsed.kind).toBe("Certificate");
  });

  it("includes the FQDN in dnsNames", () => {
    const manifest = emitCertificateManifest(baseReq, { issuerRef: "x" });
    const parsed = yaml.load(manifest) as { spec: { dnsNames: string[] } };
    expect(parsed.spec.dnsNames).toContain("abc.atlas.app");
  });

  it("references the configured ClusterIssuer", () => {
    const manifest = emitCertificateManifest(baseReq, { issuerRef: "letsencrypt-cloudflare-dns01" });
    const parsed = yaml.load(manifest) as { spec: { issuerRef: { name: string; kind: string } } };
    expect(parsed.spec.issuerRef.name).toBe("letsencrypt-cloudflare-dns01");
    expect(parsed.spec.issuerRef.kind).toBe("ClusterIssuer");
  });
});
