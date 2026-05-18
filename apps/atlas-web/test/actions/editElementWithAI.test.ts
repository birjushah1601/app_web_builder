import { describe, it, expect, vi, beforeEach } from "vitest";

// ── auth ──────────────────────────────────────────────────────────────────────
let authUserId: string | null = "u1";
vi.mock("@/lib/auth/clerk-compat", () => ({
  auth: async () => ({ userId: authUserId })
}));

// ── sandbox factory ───────────────────────────────────────────────────────────
vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({
    getOrProvision: async () => ({
      record: { sandboxId: "sb-test" },
      previewUrl: "http://localhost:3000"
    })
  })
}));

// ── E2B SDK ───────────────────────────────────────────────────────────────────
const sandboxFiles: Record<string, string> = {
  "/code/src/app/page.tsx": `export default () => <div><section data-atlas-id="hero">old</section></div>;`
};

vi.mock("@e2b/sdk", () => ({
  Sandbox: {
    connect: async () => ({
      files: {
        read: async (p: string) => sandboxFiles[p] ?? "",
        write: async (p: string, c: string) => { sandboxFiles[p] = c; },
        exists: async (_p: string) => true,
        remove: async (_p: string) => {}
      }
    })
  }
}));

// ── LLM provider ──────────────────────────────────────────────────────────────
const mockLlm = {
  name: "mock",
  complete: vi.fn(async () => ({
    content: [
      "```diff",
      "--- a/src/app/page.tsx",
      "+++ b/src/app/page.tsx",
      "@@ -1 +1 @@",
      "-export default () => <div><section data-atlas-id=\"hero\">old</section></div>;",
      "+export default () => <div><section data-atlas-id=\"hero\">new</section></div>;",
      "```"
    ].join("\n"),
    model: "mock-model",
    stopReason: "end_turn" as const,
    usage: { inputTokens: 10, outputTokens: 20 }
  })),
  stream: vi.fn()
};

vi.mock("@/lib/llm/factory", () => ({
  getLlmProvider: async () => mockLlm
}));

// ── SkillRegistry (empty) ─────────────────────────────────────────────────────
vi.mock("@atlas/skill-runtime", () => ({
  SkillRegistry: class { constructor(_skills: unknown[]) {} }
}));

// ── DeveloperRole stub ────────────────────────────────────────────────────────
// Returns a diff that rewrites "old" → "new" in the hero section.
const knownDiff = [
  "--- a/src/app/page.tsx",
  "+++ b/src/app/page.tsx",
  "@@ -1 +1 @@",
  "-export default () => <div><section data-atlas-id=\"hero\">old</section></div>;",
  "+export default () => <div><section data-atlas-id=\"hero\">new</section></div>;"
].join("\n");

vi.mock("@atlas/role-developer", () => ({
  DeveloperRole: class {
    constructor(_opts: unknown) {}
    async run(_inv: unknown) {
      return {
        events: [{ eventType: "developer.completed", payload: { summary: "ok", focusedRefine: true } }],
        diff: { kind: "patch", body: knownDiff }
      };
    }
  }
}));

beforeEach(() => {
  // Reset sandboxFiles to original state before each test.
  sandboxFiles["/code/src/app/page.tsx"] =
    `export default () => <div><section data-atlas-id="hero">old</section></div>;`;
  authUserId = "u1";
});

import { editElementWithAI } from "@/lib/actions/editElementWithAI";

describe("editElementWithAI", () => {
  it("invokes the focusedRefine branch and applies the returned diff", async () => {
    const result = await editElementWithAI({
      projectId: "11111111-1111-1111-1111-111111111111",
      filePath: "/code/src/app/page.tsx",
      atlasId: "hero",
      instruction: "make it say new"
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(sandboxFiles["/code/src/app/page.tsx"]).toContain(">new<");
  });

  it("returns ok=false when unauthorized", async () => {
    authUserId = null;

    const result = await editElementWithAI({
      projectId: "p1",
      filePath: "/code/src/app/page.tsx",
      atlasId: "hero",
      instruction: "x"
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("unauthorized");
  });
});
