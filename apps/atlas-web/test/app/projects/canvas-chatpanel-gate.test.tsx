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

// The CanvasPreviewClient lives under the page's _components folder.
vi.mock("@/app/projects/[projectId]/canvas/_components/CanvasPreviewClient", () => ({
  CanvasPreviewClient: () => <div data-testid="canvas-preview-mock" />
}));

vi.mock("@/components/ChatPanel", () => ({
  ChatPanel: ({ projectId }: { projectId: string }) => (
    <div data-testid="chat-panel-mock">chat for {projectId}</div>
  )
}));

vi.mock("@/lib/actions/startRitual", () => ({
  startRitual: vi.fn()
}));

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

async function renderPage(flagOn: boolean) {
  isFeatureEnabledMock.mockImplementation((flag: string) =>
    flag === "live-events" ? flagOn : false
  );
  const element = await CanvasPage({ params: Promise.resolve({ projectId: "p-canvas" }) });
  return render(element as React.ReactElement);
}

describe("CanvasPage — ChatPanel gate (plan G)", () => {
  it("mounts ChatPanel when live-events is OFF (today's behaviour)", async () => {
    await renderPage(false);
    expect(screen.getByTestId("chat-panel-mock")).toBeInTheDocument();
    expect(screen.getByText(/chat for p-canvas/)).toBeInTheDocument();
  });

  it("does NOT mount ChatPanel when live-events is ON (the rail owns it)", async () => {
    await renderPage(true);
    expect(screen.queryByTestId("chat-panel-mock")).not.toBeInTheDocument();
    expect(screen.getByTestId("canvas-client-mock")).toBeInTheDocument();
  });
});
