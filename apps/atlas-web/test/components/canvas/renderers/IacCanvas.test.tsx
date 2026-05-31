import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { IacCanvas } from "@/components/canvas/renderers/IacCanvas";

const ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "iac" as const,
  compose: { file: "docker-compose.yml", content: "version: '3'\nservices:\n  api:\n    image: registry.local/proj/api:latest" },
  k8s: {
    manifests: [
      { file: "k8s/api.yaml", kind: "Knative Service", name: "api", content: "apiVersion: serving.knative.dev/v1\nkind: Service" },
      { file: "k8s/cert.yaml", kind: "Certificate", name: "wildcard", content: "apiVersion: cert-manager.io/v1\nkind: Certificate" }
    ]
  },
  services: [
    { name: "api", runtimeNodeId: "backend", artifactKind: "backend-rest-api", port: 8000, envContract: [{ name: "DATABASE_URL", required: true }] },
    { name: "web", runtimeNodeId: "frontend", artifactKind: "frontend-app", port: 3000, envContract: [] }
  ],
  imageRegistry: { url: "registry.local", namespace: "proj" }
};

describe("IacCanvas", () => {
  it("renders the empty-state when artifact is undefined", () => {
    render(<IacCanvas artifact={undefined} />);
    expect(screen.getByTestId("iac-canvas-empty")).toBeInTheDocument();
  });

  it("renders one row per service with name + artifactKind + port", () => {
    render(<IacCanvas artifact={ARTIFACT} />);
    const apiRow = screen.getByTestId("iac-services-row-api");
    expect(apiRow).toHaveTextContent("api");
    expect(apiRow).toHaveTextContent("backend-rest-api");
    expect(apiRow).toHaveTextContent("8000");
    expect(screen.getByTestId("iac-services-row-web")).toBeInTheDocument();
  });

  it("renders the compose YAML content in a code block", () => {
    render(<IacCanvas artifact={ARTIFACT} />);
    expect(screen.getByTestId("iac-compose-content")).toHaveTextContent(/version: '3'/);
    expect(screen.getByTestId("iac-compose-content")).toHaveTextContent(/registry.local\/proj\/api/);
  });

  it("renders one row per k8s manifest", () => {
    render(<IacCanvas artifact={ARTIFACT} />);
    const apiManifest = screen.getByTestId("iac-manifest-row-api");
    expect(apiManifest).toHaveTextContent("Knative Service");
    expect(apiManifest).toHaveTextContent("k8s/api.yaml");
    expect(screen.getByTestId("iac-manifest-row-wildcard")).toBeInTheDocument();
  });

  it("reveals manifest YAML on view-toggle click", () => {
    render(<IacCanvas artifact={ARTIFACT} />);
    // initially hidden
    expect(screen.queryByTestId("iac-manifest-content-api")).toBeNull();
    fireEvent.click(screen.getByTestId("iac-manifest-toggle-api"));
    expect(screen.getByTestId("iac-manifest-content-api")).toHaveTextContent("serving.knative.dev");
  });
});
