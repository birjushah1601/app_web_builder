// Deterministic CanvasManifests for the visual fixture routes that need a
// preview-shell mode (mode-toggle, schema-canvas). The shape mirrors what
// @atlas/canvas-runtime emits, but we hard-code it here so the fixture
// routes don't depend on the live ritual pipeline.

export const cannedFrontendManifest = {
  artifactKind: "frontend-app" as const,
  modes: [
    {
      id: "designing",
      renderer: "designer-canvas-v1",
      audience: ["ama", "diego", "priya"] as const,
      default: true,
      blockingFor: "design" as const
    },
    {
      id: "preview",
      renderer: "preview-canvas-v1",
      audience: ["ama", "diego", "priya"] as const,
      blockingFor: null
    },
    {
      id: "refine",
      renderer: "refine-wizard-v1",
      audience: ["ama", "diego", "priya"] as const,
      blockingFor: null
    }
  ]
};

export const cannedBackendManifest = {
  artifactKind: "backend-rest-api" as const,
  modes: [
    {
      id: "schema",
      renderer: "schema-canvas-v1",
      audience: ["diego", "priya"] as const,
      default: true,
      blockingFor: "schema" as const
    }
  ]
};
