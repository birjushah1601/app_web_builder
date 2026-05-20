import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// D18a — pre-warm hook. The action calls getSandboxFactory().getOrProvision
// fire-and-forget when ATLAS_FF_SANDBOX_PREWARM is on. Mock the factory so
// tests assert on the call without touching real E2B.
const getOrProvisionMock = vi.fn(async () => ({
  record: { sandboxId: "sb_p-uuid", templateId: "atlas-next-ts" },
  previewUrl: "https://3000-sb_p-uuid.e2b.app"
}));
vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({ getOrProvision: getOrProvisionMock })
}));

describe("submitPromptedProject", () => {
  const savedPrewarm = process.env.ATLAS_FF_SANDBOX_PREWARM;
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ATLAS_FF_SANDBOX_PREWARM;
  });
  afterEach(() => {
    if (savedPrewarm === undefined) delete process.env.ATLAS_FF_SANDBOX_PREWARM;
    else process.env.ATLAS_FF_SANDBOX_PREWARM = savedPrewarm;
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
        editClass: "structural",
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

  // ---------------- D18a: sandbox pre-warm on project creation ----------------

  it("does NOT pre-warm sandbox when ATLAS_FF_SANDBOX_PREWARM is off (default)", async () => {
    const { submitPromptedProject } = await import("@/app/projects/new/actions");
    const fd = new FormData();
    fd.set("prompt", "Build a cookbook landing page");
    fd.set("kind", "frontend-app");
    await expect(submitPromptedProject(fd)).rejects.toThrow(/REDIRECT:/);
    expect(getOrProvisionMock).not.toHaveBeenCalled();
  });

  it("pre-warms sandbox at project creation when ATLAS_FF_SANDBOX_PREWARM is on", async () => {
    process.env.ATLAS_FF_SANDBOX_PREWARM = "true";
    const { submitPromptedProject } = await import("@/app/projects/new/actions");
    const fd = new FormData();
    fd.set("prompt", "Build a cookbook landing page");
    fd.set("kind", "frontend-app");
    await expect(submitPromptedProject(fd)).rejects.toThrow(
      /REDIRECT:\/projects\/p-uuid\/canvas/
    );
    // Fire-and-forget: the action redirects without awaiting. The
    // getOrProvision call is queued synchronously, so by the time the
    // redirect-throw lands the mock has been invoked exactly once for the
    // newly created project.
    expect(getOrProvisionMock).toHaveBeenCalledTimes(1);
    expect(getOrProvisionMock).toHaveBeenCalledWith("p-uuid");
  });

  it("pre-warm failure does NOT block project creation (failure-safe)", async () => {
    process.env.ATLAS_FF_SANDBOX_PREWARM = "true";
    getOrProvisionMock.mockRejectedValueOnce(new Error("E2B 503"));
    // Silence the expected warning so the test output stays clean.
    const errSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { submitPromptedProject } = await import("@/app/projects/new/actions");
    const fd = new FormData();
    fd.set("prompt", "Build a cookbook landing page");
    fd.set("kind", "frontend-app");
    // Redirect still fires — pre-warm failure must not surface to the user.
    await expect(submitPromptedProject(fd)).rejects.toThrow(/REDIRECT:/);
    expect(getOrProvisionMock).toHaveBeenCalledTimes(1);
    // Give the queued microtask + rejection handler a tick to run so the
    // catch() observes the rejection before the test exits and Node logs
    // an "unhandled rejection" diagnostic.
    await new Promise((r) => setImmediate(r));
    errSpy.mockRestore();
  });
});
