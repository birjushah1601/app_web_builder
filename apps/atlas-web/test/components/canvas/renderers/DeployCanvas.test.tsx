import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { DeployCanvas } from "@/components/canvas/renderers/DeployCanvas";

const ARTIFACT = {
  schemaVersion: "1" as const,
  kind: "deploy" as const,
  target: "k8s" as const,
  argoApplication: { file: "argo/app.yaml", content: "kind: Application", name: "proj-1", repoUrl: "git@example.com:proj.git", path: "k8s/" },
  imageBuilds: [
    { serviceName: "api", dockerfilePath: "Dockerfile.api", imageTag: "registry.local/proj/api:sha-1" },
    { serviceName: "web", dockerfilePath: "Dockerfile.web", imageTag: "registry.local/proj/web:sha-1" }
  ],
  smokeTests: [
    { url: "/health", expectStatus: 200 },
    { url: "/api/v1/status", method: "post" as const, expectStatus: 201, expectBodyContains: "ok" }
  ]
};

describe("DeployCanvas", () => {
  it("renders the empty-state when artifact is undefined", () => {
    render(<DeployCanvas artifact={undefined} />);
    expect(screen.getByTestId("deploy-canvas-empty")).toBeInTheDocument();
  });

  it("renders the Argo Application summary with name + repoUrl + path", () => {
    render(<DeployCanvas artifact={ARTIFACT} />);
    const summary = screen.getByTestId("deploy-argo-summary");
    expect(summary).toHaveTextContent("proj-1");
    expect(summary).toHaveTextContent("git@example.com:proj.git");
    expect(summary).toHaveTextContent("k8s/");
  });

  it("renders one row per imageBuild", () => {
    render(<DeployCanvas artifact={ARTIFACT} />);
    const apiRow = screen.getByTestId("deploy-image-row-api");
    expect(apiRow).toHaveTextContent("Dockerfile.api");
    expect(apiRow).toHaveTextContent("registry.local/proj/api:sha-1");
    expect(screen.getByTestId("deploy-image-row-web")).toBeInTheDocument();
  });

  it("renders one row per smokeTest with method + status + body", () => {
    render(<DeployCanvas artifact={ARTIFACT} />);
    const healthRow = screen.getByTestId("deploy-smoke-row-/health");
    expect(healthRow).toHaveTextContent("/health");
    expect(healthRow).toHaveTextContent("200");
    expect(healthRow).toHaveTextContent(/get/i);   // default method
    const statusRow = screen.getByTestId("deploy-smoke-row-/api/v1/status");
    expect(statusRow).toHaveTextContent(/post/i);
    expect(statusRow).toHaveTextContent("ok");
  });

  it("renders the F.2 future banner", () => {
    render(<DeployCanvas artifact={ARTIFACT} />);
    expect(screen.getByTestId("deploy-future-banner")).toHaveTextContent(/Plan F\.2/i);
  });
});

describe("DeployCanvas — Plan F.2 deployed-state rendering", () => {
  const DEPLOY_RESULT = {
    deployId: "d-1",
    publicUrl: "https://proj-1.atlas.dev",
    argoApplicationName: "proj-1-main",
    branchSchemaName: "branch_main",
    appliedManifests: [
      { namespace: "atlas-projects", kind: "Service", name: "api" },
      { namespace: "atlas-projects", kind: "Service", name: "web" },
      { namespace: "atlas-projects", kind: "Certificate", name: "wildcard" }
    ],
    phase: "healthy" as const,
    startedAt: "2026-06-02T00:00:00.000Z"
  };

  it("renders the deployed-state header with publicUrl link when deployResult is set", () => {
    render(<DeployCanvas artifact={ARTIFACT} deployResult={DEPLOY_RESULT} />);
    const header = screen.getByTestId("deploy-runtime-header");
    expect(header).toBeInTheDocument();
    const link = screen.getByTestId("deploy-runtime-publicurl");
    expect(link).toHaveAttribute("href", "https://proj-1.atlas.dev");
    expect(link).toHaveTextContent("https://proj-1.atlas.dev");
  });

  it("shows the Argo Application name + applied-manifest count in the deployed header", () => {
    render(<DeployCanvas artifact={ARTIFACT} deployResult={DEPLOY_RESULT} />);
    const header = screen.getByTestId("deploy-runtime-header");
    expect(header).toHaveTextContent(/proj-1-main/);
    expect(header).toHaveTextContent(/3.*applied|applied.*3/i);
  });

  it("uses a red header when phase is failed", () => {
    render(<DeployCanvas artifact={ARTIFACT} deployResult={{ ...DEPLOY_RESULT, phase: "failed" }} />);
    expect(screen.getByTestId("deploy-runtime-header").className).toMatch(/red/);
  });

  it("uses a green header when phase is healthy", () => {
    render(<DeployCanvas artifact={ARTIFACT} deployResult={DEPLOY_RESULT} />);
    expect(screen.getByTestId("deploy-runtime-header").className).toMatch(/emerald|green/);
  });

  it("hides the F.2 future banner when deployResult is set", () => {
    render(<DeployCanvas artifact={ARTIFACT} deployResult={DEPLOY_RESULT} />);
    expect(screen.queryByTestId("deploy-future-banner")).toBeNull();
  });

  it("still shows the F.2 future banner when deployResult is absent (today's Plan F behavior)", () => {
    render(<DeployCanvas artifact={ARTIFACT} />);
    expect(screen.getByTestId("deploy-future-banner")).toBeInTheDocument();
  });
});

describe("DeployCanvas — Plan F.3 smoke result badges", () => {
  const DEPLOY_RESULT = {
    deployId: "d-1",
    publicUrl: "https://proj-1.atlas.dev",
    argoApplicationName: "proj-1-main",
    branchSchemaName: "branch_main",
    appliedManifests: [
      { namespace: "atlas-projects", kind: "Service", name: "api" }
    ],
    phase: "healthy" as const,
    startedAt: "2026-06-02T00:00:00.000Z"
  };

  const ARTIFACT_WITH_SMOKES = {
    ...ARTIFACT,
    smokeTests: [
      { url: "/health", expectStatus: 200 },
      { url: "/api/v1/status", method: "post" as const, expectStatus: 201 }
    ]
  };

  it("renders a pass badge with latency when smoke result is ok", () => {
    render(
      <DeployCanvas
        artifact={ARTIFACT_WITH_SMOKES}
        deployResult={{
          ...DEPLOY_RESULT,
          smokeResults: [
            { url: "/health", method: "get", status: 200, ok: true, latencyMs: 42, expectStatus: 200 },
            { url: "/api/v1/status", method: "post", status: 201, ok: true, latencyMs: 88, expectStatus: 201 }
          ]
        }}
      />
    );
    const row = screen.getByTestId("deploy-smoke-row-/health");
    expect(row).toHaveTextContent(/200/);
    expect(row).toHaveTextContent(/42 ?ms/);
    // Pass should NOT have red styling
    expect(row.className).not.toMatch(/red/);
  });

  it("renders a fail badge with error when smoke result is not ok", () => {
    render(
      <DeployCanvas
        artifact={ARTIFACT_WITH_SMOKES}
        deployResult={{
          ...DEPLOY_RESULT,
          smokeResults: [
            { url: "/health", method: "get", status: 500, ok: false, latencyMs: 100, expectStatus: 200, error: "status 500 did not match expected 200" }
          ]
        }}
      />
    );
    const row = screen.getByTestId("deploy-smoke-row-/health");
    expect(row).toHaveTextContent(/did not match/i);
    expect(row.className).toMatch(/red/);
  });

  it("renders no result cell when deployResult is unset (today's Plan F.2 behavior)", () => {
    render(<DeployCanvas artifact={ARTIFACT_WITH_SMOKES} />);
    const row = screen.getByTestId("deploy-smoke-row-/health");
    // No latency rendering; no "42ms" or similar
    expect(row).not.toHaveTextContent(/ms/);
  });

  it("renders no result cell when deployResult is set but smokeResults is omitted (zero smokes ran)", () => {
    render(
      <DeployCanvas
        artifact={ARTIFACT_WITH_SMOKES}
        deployResult={{ ...DEPLOY_RESULT /* no smokeResults field */ }}
      />
    );
    const row = screen.getByTestId("deploy-smoke-row-/health");
    expect(row).not.toHaveTextContent(/ms/);
  });
});
