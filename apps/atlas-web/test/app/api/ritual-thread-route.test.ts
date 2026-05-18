import { describe, it, expect, vi } from "vitest";

const getRitualMock = vi.fn();

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, cache: <T,>(fn: T) => fn };
});
vi.mock("@/lib/auth/clerk-compat", () => ({ auth: () => ({ userId: "u-1" }) }));
vi.mock("@/lib/engine/factory", () => ({
  getRitualEngine: vi.fn(async () => ({ getRitual: getRitualMock }))
}));

import { GET } from "@/app/api/projects/[projectId]/ritual/[ritualId]/thread/route";

describe("GET /api/projects/[id]/ritual/[id]/thread — Plan K Task 6", () => {
  it("returns array root → leaf when ritual chain has 3 entries", async () => {
    getRitualMock.mockImplementation(async (id: string) => {
      if (id === "r-leaf") return { projectId: "p", userId: "u-1", state: "done", roleEvents: [], parentRitualId: "r-mid" };
      if (id === "r-mid")  return { projectId: "p", userId: "u-1", state: "done", roleEvents: [], parentRitualId: "r-root" };
      if (id === "r-root") return { projectId: "p", userId: "u-1", state: "done", roleEvents: [] };
      return undefined;
    });
    const res = await GET(new Request("https://x/x"), { params: Promise.resolve({ projectId: "p", ritualId: "r-leaf" }) });
    const body = await res.json() as { thread: Array<{ parentRitualId?: string }> };
    expect(body.thread.length).toBe(3);
    expect(body.thread[0]!.parentRitualId).toBeUndefined();   // root first
    expect(body.thread[2]!.parentRitualId).toBe("r-mid");      // leaf last
  });

  it("returns 404 when the requested ritualId is unknown", async () => {
    getRitualMock.mockResolvedValue(undefined);
    const res = await GET(new Request("https://x/x"), { params: Promise.resolve({ projectId: "p", ritualId: "r-?" }) });
    expect(res.status).toBe(404);
  });

  it("returns 403 when the requested ritual's projectId does not match the URL projectId", async () => {
    getRitualMock.mockResolvedValue({ projectId: "p-OTHER", userId: "u-1", state: "done", roleEvents: [] });
    const res = await GET(new Request("https://x/x"), { params: Promise.resolve({ projectId: "p", ritualId: "r-x" }) });
    expect(res.status).toBe(403);
  });
});
