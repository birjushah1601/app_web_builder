import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// Stand-ins for the heavy server-side dependencies of the canvas page.
vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({
    getOrProvision: vi.fn(async () => ({
      previewUrl: "https://preview.test",
      record: { sandboxId: "sb-1" }
    }))
  })
}));

vi.mock("@/components/CanvasClient", () => ({
  CanvasClient: () => <div data-testid="canvas-client-mock" />
}));

vi.mock("@/app/projects/[projectId]/canvas/_components/CanvasPreviewClient", () => ({
  CanvasPreviewClient: () => <div data-testid="canvas-preview-mock" />
}));

vi.mock("@/components/canvas/CanvasShell", () => ({
  CanvasShell: () => <div data-testid="canvas-shell-mock" />
}));

// register-renderers is a side-effect import — neutralise it.
vi.mock("@/components/canvas/register-renderers", () => ({}));

vi.mock("@/components/ChatPanel", () => ({
  ChatPanel: () => <div data-testid="chat-panel-mock" />
}));

vi.mock("@/lib/actions/startRitual", () => ({ startRitual: vi.fn() }));
vi.mock("@/lib/actions/refineRitual", () => ({ refineRitual: vi.fn() }));

const isFeatureEnabledMock = vi.fn();
vi.mock("@/lib/feature-flags", async () => {
  const actual = await vi.importActual<typeof import("@/lib/feature-flags")>(
    "@/lib/feature-flags"
  );
  return {
    ...actual,
    isFeatureEnabled: (...args: Parameters<typeof actual.isFeatureEnabled>) =>
      isFeatureEnabledMock(...args)
  };
});

import CanvasPage from "@/app/projects/[projectId]/canvas/page";

beforeEach(() => {
  isFeatureEnabledMock.mockReset();
});

async function renderPage(canvasV1On: boolean) {
  isFeatureEnabledMock.mockImplementation((flag: string) => {
    if (flag === "canvas-v1") return canvasV1On;
    return false;
  });
  const element = await CanvasPage({ params: Promise.resolve({ projectId: "p-1" }) });
  return render(element as React.ReactElement);
}

describe("CanvasPage — canvas-v1 flag gate (Plan S.4)", () => {
  it("flag-OFF preserves today's preview-only tree (CanvasPreviewClient mounted, no CanvasShell)", async () => {
    await renderPage(false);
    expect(screen.getByTestId("canvas-preview-mock")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-shell-mock")).not.toBeInTheDocument();
  });

  it("flag-ON mounts <CanvasShell> in place of the preview-only canvas", async () => {
    await renderPage(true);
    expect(screen.getByTestId("canvas-shell-mock")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-preview-mock")).not.toBeInTheDocument();
  });
});
