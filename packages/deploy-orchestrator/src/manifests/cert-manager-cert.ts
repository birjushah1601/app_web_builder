import yaml from "js-yaml";
import type { DeployRequest } from "../types.js";

export interface CertEmitOptions {
  issuerRef: string;
}

export function certificateName(req: DeployRequest): string {
  return `cert-${req.subdomain}-${req.branchId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function tlsSecretName(req: DeployRequest): string {
  return `tls-${req.subdomain}-${req.branchId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export function emitCertificateManifest(req: DeployRequest, opts: CertEmitOptions): string {
  const fqdn = `${req.subdomain}.${req.apex}`;
  const doc = {
    apiVersion: "cert-manager.io/v1",
    kind: "Certificate",
    metadata: {
      name: certificateName(req),
      namespace: "atlas-projects"
    },
    spec: {
      secretName: tlsSecretName(req),
      dnsNames: [fqdn],
      issuerRef: { name: opts.issuerRef, kind: "ClusterIssuer", group: "cert-manager.io" }
    }
  };
  return yaml.dump(doc, { lineWidth: -1 });
}
