import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// The layout is a Server Component; we test it by rendering it as if it
// were any async component (call it, await the promise, render the JSX).

// Mock the auth shim so the layout's auth gate passes.
vi.mock("@/lib/auth/clerk-compat", () => ({
  auth: vi.fn(async () => ({ userId: "test-user" })),
  currentUser: vi.fn(async () => ({ publicMetadata: { defaultPersona: "ama" } }))
}));

// Mock the persona prefs lookup so we don't need a real Pool.
vi.mock("pg", () => ({
  Pool: vi.fn().mockImplementation(() => ({}))
}));
vi.mock("@atlas/spec-graph-data", () => ({
  PreferencesRepo: vi.fn().mockImplementation(() => ({
    getOverride: vi.fn(async () => null)
  }))
}));

// Mock the rail to a stand-in so we can detect mount/no-mount cleanly.
vi.mock("@/components/shell/RailShell", () => ({
  RailShell: ({ projectId }: { projectId: string }) => (
    <div data-testid="rail-shell-mock">rail for {projectId}</div>
  )
}));

// Mock the PersonaToggleClient — it calls useRouter() from next/navigation
// which throws "invariant expected app router to be mounted" outside a
// proper Next.js page context. This test only cares about layout-tree
// shape, not the toggle internals (covered by its own component test).
vi.mock("@/components/PersonaToggleClient", () => ({
  PersonaToggleClient: ({ projectId, current }: { projectId: string; current: string }) => (
    <span data-testid="persona-toggle-host-mock" data-project-id={projectId} data-current={current}>
      persona toggle for {current}
    </span>
  )
}));

// Mock EventSourceProvider similarly.
vi.mock("@/lib/events/EventSourceProvider", () => ({
  EventSourceProvider: ({
    projectId,
    flagEnabled,
    children
  }: {
    projectId: string;
    flagEnabled: boolean;
    children: React.ReactNode;
  }) => (
    <div
      data-testid="event-source-provider-mock"
      data-project-id={projectId}
      data-flag={String(flagEnabled)}
    >
      {children}
    </div>
  )
}));

// The flag is read by the layout — mockable via the module mock.
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

import ProjectLayout from "@/app/projects/[projectId]/layout";

beforeEach(() => {
  isFeatureEnabledMock.mockReset();
});

async function renderLayout(flagOn: boolean) {
  isFeatureEnabledMock.mockImplementation((flag: string) =>
    flag === "live-events" ? flagOn : false
  );
  const element = await ProjectLayout({
    children: <div data-testid="page-children">page content</div>,
    params: Promise.resolve({ projectId: "proj-xyz" })
  });
  return render(element as React.ReactElement);
}

describe("ProjectLayout — flag OFF (today's behaviour, untouched)", () => {
  it("does NOT mount the RailShell when live-events is off", async () => {
    await renderLayout(false);
    expect(screen.queryByTestId("rail-shell-mock")).not.toBeInTheDocument();
  });

  it("renders the children directly (no rail wrapper)", async () => {
    await renderLayout(false);
    expect(screen.getByTestId("page-children")).toBeInTheDocument();
  });
});

describe("ProjectLayout — flag ON (Plan G chrome)", () => {
  it("mounts the RailShell with the projectId", async () => {
    await renderLayout(true);
    const rail = screen.getByTestId("rail-shell-mock");
    expect(rail).toBeInTheDocument();
    expect(rail.textContent).toContain("proj-xyz");
  });

  it("wraps the entire subtree in EventSourceProvider with the same projectId + flagEnabled=true", async () => {
    await renderLayout(true);
    const provider = screen.getByTestId("event-source-provider-mock");
    expect(provider).toBeInTheDocument();
    expect(provider.getAttribute("data-project-id")).toBe("proj-xyz");
    expect(provider.getAttribute("data-flag")).toBe("true");
    expect(screen.getByTestId("page-children")).toBeInTheDocument();
  });
});
