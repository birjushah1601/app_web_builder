import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

// Mock heavy server-only deps so the layout can render in jsdom.
vi.mock("@/lib/auth/clerk-compat", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "user_test" }),
  currentUser: vi.fn().mockResolvedValue({ publicMetadata: {} })
}));
vi.mock("@atlas/spec-graph-data", () => ({
  PreferencesRepo: class { async getOverride() { return undefined; } }
}));
vi.mock("pg", () => ({ Pool: class {} }));
vi.mock("@/lib/events/EventSourceProvider", () => ({
  EventSourceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>
}));
vi.mock("@/components/shell/RailShell", () => ({
  RailShell: () => <aside data-testid="rail-shell">RailShell stub</aside>
}));
vi.mock("@/components/ritual/RitualStatusStrip", () => ({
  RitualStatusStrip: () => <div data-testid="ritual-status-strip">strip stub</div>
}));
vi.mock("@/components/shell/EditorShell", () => ({
  EditorShell: ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) => (
    <div data-testid="editor-shell">{left}{right}</div>
  )
}));
// PersonaToggleClient uses useRouter() from next/navigation which throws
// outside a real Next.js page mount. Stub it; this spec only verifies
// the editor-layout-v2 flag-branch tree shape.
vi.mock("@/components/PersonaToggleClient", () => ({
  PersonaToggleClient: () => <span data-testid="persona-toggle-host-stub" />
}));

const flagState = { "editor-layout-v2": false, "live-events": true, "multi-turn": false };
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (name: string) => flagState[name as keyof typeof flagState] ?? false
}));

import ProjectLayout from "@/app/projects/[projectId]/layout";

async function renderLayout() {
  const tree = await ProjectLayout({
    children: <div data-testid="page-children">page</div>,
    params: Promise.resolve({ projectId: "p-1" })
  });
  return render(tree as React.ReactElement);
}

describe("ProjectLayout — Plan R flag-OFF behavioural lock", () => {
  beforeEach(() => { cleanup(); flagState["editor-layout-v2"] = false; });

  it("renders today's exact tree when editor-layout-v2 is OFF", async () => {
    await renderLayout();
    // Today's Plan G shape: top nav + RailShell + main with children
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByTestId("rail-shell")).toBeInTheDocument();
    expect(screen.getByTestId("page-children")).toBeInTheDocument();
    // Plan R additions MUST NOT be present
    expect(screen.queryByTestId("ritual-status-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("editor-shell")).not.toBeInTheDocument();
    expect(screen.queryByTestId("editor-shell-handle")).not.toBeInTheDocument();
  });

  it("renders Plan R chrome when editor-layout-v2 is ON", async () => {
    flagState["editor-layout-v2"] = true;
    await renderLayout();
    expect(screen.getByTestId("ritual-status-strip")).toBeInTheDocument();
    expect(screen.getByTestId("editor-shell")).toBeInTheDocument();
    // RailShell stub still mounts as the LEFT panel content
    expect(screen.getByTestId("rail-shell")).toBeInTheDocument();
    // Page children mount as the RIGHT panel content
    expect(screen.getByTestId("page-children")).toBeInTheDocument();
  });
});
