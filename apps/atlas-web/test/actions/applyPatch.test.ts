import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u1" }) }));

const writes: Record<string, string> = {};
vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({
    getOrProvision: async () => ({
      record: { sandboxId: "sb" },
      previewUrl: "https://sb.e2b.app"
    })
  })
}));
vi.mock("@e2b/sdk", () => ({
  Sandbox: {
    connect: async () => ({
      files: {
        read: async (p: string) => writes[p] ?? `export default () => <h1 data-atlas-id="h">Hello</h1>;`,
        write: async (p: string, c: string) => { writes[p] = c; }
      }
    })
  }
}));

import { applyPatch } from "@/lib/actions/applyPatch";

describe("applyPatch Server Action", () => {
  beforeEach(() => { for (const k of Object.keys(writes)) delete writes[k]; });

  it("applies a text-replace patch to the targeted file", async () => {
    const result = await applyPatch({
      projectId: "11111111-1111-1111-1111-111111111111",
      filePath: "/code/src/app/page.tsx",
      patch: {
        kind: "text-replace",
        atlasId: "h",
        oldText: "Hello",
        newText: "Hi"
      }
    });
    expect(result.ok).toBe(true);
    expect(result.inverse).toMatchObject({ kind: "text-replace", oldText: "Hi", newText: "Hello" });
    expect(writes["/code/src/app/page.tsx"]).toContain("Hi");
  });

  it("returns ok=false with error=not-found when atlasId missing", async () => {
    const result = await applyPatch({
      projectId: "11111111-1111-1111-1111-111111111111",
      filePath: "/code/src/app/page.tsx",
      patch: {
        kind: "text-replace",
        atlasId: "missing",
        oldText: "x",
        newText: "y"
      }
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not-found");
  });
});
