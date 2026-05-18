import { describe, it, expect } from "vitest";
import { applyDiff } from "@/lib/sandbox/apply-diff";

describe("applyDiff — atlas-id annotation", () => {
  it("annotates .tsx files with data-atlas-id after writing", async () => {
    const writes: Record<string, string> = {};
    const fs = {
      write: async (p: string, c: string) => { writes[p] = c; },
      read: async (p: string) => writes[p] ?? "",
      exists: async (_p: string) => false,
      remove: async (_p: string) => {}
    };
    const diff = `--- a/src/app/page.tsx
+++ b/src/app/page.tsx
@@ -0,0 +1,3 @@
+export default function Page() {
+  return <h1>Hello</h1>;
+}
`;
    const result = await applyDiff(fs as never, diff);
    expect(result.ok).toBe(true);
    expect(writes["/code/src/app/page.tsx"]).toContain("data-atlas-id=");
  });

  it("skips annotation for non-.tsx files", async () => {
    const writes: Record<string, string> = {};
    const fs = {
      write: async (p: string, c: string) => { writes[p] = c; },
      read: async () => "",
      exists: async (_p: string) => false,
      remove: async (_p: string) => {}
    };
    const diff = `--- a/src/styles.css
+++ b/src/styles.css
@@ -0,0 +1,1 @@
+body { color: red; }
`;
    await applyDiff(fs as never, diff);
    expect(writes["/code/src/styles.css"]).not.toContain("data-atlas-id");
  });
});
