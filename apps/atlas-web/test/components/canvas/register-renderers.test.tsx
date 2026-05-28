import { describe, it, expect, beforeAll } from "vitest";

describe("register-renderers — Plan C stub registrations", () => {
  beforeAll(async () => {
    await import("@/components/canvas/register-renderers");
  });

  it("registers the four non-frontend stub renderers", async () => {
    const { canvasModeRegistry } = await import(
      "@/components/canvas/canvas-mode-registry"
    );
    expect(canvasModeRegistry.lookup("swagger")).toBeDefined();
    expect(canvasModeRegistry.lookup("test-results")).toBeDefined();
    expect(canvasModeRegistry.lookup("topology")).toBeDefined();
    expect(canvasModeRegistry.lookup("deploy-status")).toBeDefined();
  });

  it("keeps the v1 renderers registered (regression guard)", async () => {
    const { canvasModeRegistry } = await import(
      "@/components/canvas/canvas-mode-registry"
    );
    expect(canvasModeRegistry.lookup("designing")).toBeDefined();
    expect(canvasModeRegistry.lookup("preview")).toBeDefined();
    expect(canvasModeRegistry.lookup("schema")).toBeDefined();
  });
});
