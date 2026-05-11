import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/clerk-compat", () => ({
  auth: vi.fn(async () => ({ userId: "u1" }))
}));
vi.mock("@/lib/actions/startRitual", () => ({
  startRitual: vi.fn(async () => "r-1")
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((u: string) => {
    throw new Error("REDIRECT:" + u);
  })
}));
const createMock = vi.fn(async ({ name }: { name: string }) => ({
  projectId: "p-uuid",
  userId: "u1",
  name
}));
vi.mock("@atlas/spec-graph-data", () => ({
  ProjectsRepo: class {
    create = createMock;
  }
}));
vi.mock("pg", () => ({ Pool: class {} }));

describe("submitPromptedProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives name from prompt + fires startRitual with hint + redirects", async () => {
    const { submitPromptedProject } = await import("@/app/projects/new/actions");
    const { startRitual } = await import("@/lib/actions/startRitual");
    const fd = new FormData();
    fd.set("prompt", "Build a landing page for my Mumbai spice kitchen");
    fd.set("kind", "frontend-app");
    await expect(submitPromptedProject(fd)).rejects.toThrow(
      /REDIRECT:\/projects\/p-uuid\/canvas/
    );
    expect(createMock).toHaveBeenCalledWith({
      userId: "u1",
      name: "landing-page-mumbai-spice-kitchen"
    });
    expect(startRitual).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p-uuid",
        userTurn: "Build a landing page for my Mumbai spice kitchen",
        artifactKindHint: "frontend-app"
      })
    );
  });

  it("omits artifactKindHint when kind is 'auto'", async () => {
    const { submitPromptedProject } = await import("@/app/projects/new/actions");
    const { startRitual } = await import("@/lib/actions/startRitual");
    const fd = new FormData();
    fd.set("prompt", "Make a todo app");
    fd.set("kind", "auto");
    await expect(submitPromptedProject(fd)).rejects.toThrow(/REDIRECT:/);
    const call = (startRitual as unknown as { mock: { calls: [Record<string, unknown>][] } }).mock.calls.at(-1)![0];
    expect(call.artifactKindHint).toBeUndefined();
  });

  it("rejects empty prompt", async () => {
    const { submitPromptedProject } = await import("@/app/projects/new/actions");
    const fd = new FormData();
    fd.set("prompt", "   ");
    fd.set("kind", "auto");
    await expect(submitPromptedProject(fd)).rejects.toThrow(/prompt required/);
  });

  it("rejects when no auth", async () => {
    const { auth } = await import("@/lib/auth/clerk-compat");
    (auth as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      userId: null
    });
    const { submitPromptedProject } = await import("@/app/projects/new/actions");
    const fd = new FormData();
    fd.set("prompt", "x");
    fd.set("kind", "auto");
    await expect(submitPromptedProject(fd)).rejects.toThrow(/unauthorized/);
  });
});
