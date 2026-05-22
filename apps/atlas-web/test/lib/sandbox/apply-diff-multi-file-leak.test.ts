import { describe, it, expect } from "vitest";
import { parseDiff } from "@/lib/sandbox/apply-diff";

/**
 * Regression for D14 — captured 2026-05-20 on the "Saffron Table" ritual.
 *
 * Symptom: `src/app/layout.tsx` was written to the sandbox with its real
 * content ending and then immediately followed by the next file's header
 * (`diff --git a/src/app/globals.css ...` / `+++ b/src/app/globals.css`).
 * Sandbox typecheck failed with `Expected ';', '}' or <eof>` because TS
 * was parsing the next file's diff header as JavaScript.
 *
 * Root cause: when the LLM overstates `@@ -0,0 +1,N @@` (declared N
 * larger than actual `+` count), `repairCreateHunkCounts` walks forward
 * counting `+`-prefixed lines until it hits a chunk-end marker. The
 * original CHUNK_END_RE only recognised `@@`, `diff --git `, `Index: `,
 * `--- ` — so when the next file's section omitted `diff --git` or
 * `--- /dev/null` (LLM diffs frequently do), the walker swept past the
 * boundary and counted the next file's `+++ b/<path>` line as if it
 * belonged to the current chunk. The synthesized header then over-shot,
 * parse-diff stayed in chunk-mode past the file boundary, and the next
 * file's `+++ ` line + content lines were captured as `add` changes in
 * the previous file's chunk.
 */
describe("parseDiff — multi-file create-hunk boundary (D14)", () => {
  it("does not leak the next file's +++ header into the previous file's content", () => {
    // File 1: layout.tsx with OVERSTATED count (+1,10 but actually 5 lines).
    // File 2: globals.css. We deliberately omit both `diff --git` AND
    // `--- /dev/null` from File 2 to simulate the LLM-formatted diff shape
    // that triggered D14 — when both standard chunk-end markers are absent,
    // the walker swept past the boundary and counted File 2's `+++ b/path`
    // line as a `+` line of File 1's chunk, then synthesized a hunk header
    // whose declared count covered File 2's content.
    const diff =
      "diff --git a/src/app/layout.tsx b/src/app/layout.tsx\n" +
      "new file mode 100644\n" +
      "--- /dev/null\n" +
      "+++ b/src/app/layout.tsx\n" +
      "@@ -0,0 +1,10 @@\n" +
      "+export default function RootLayout({ children }: { children: React.ReactNode }) {\n" +
      "+  return (\n" +
      "+    <html><body>{children}</body></html>\n" +
      "+  );\n" +
      "+}\n" +
      "new file mode 100644\n" +
      "+++ b/src/app/globals.css\n" +
      "@@ -0,0 +1,3 @@\n" +
      "+body {\n" +
      "+  color: red;\n" +
      "+}\n";

    const { ops, error } = parseDiff(diff);
    expect(error).toBeUndefined();

    const layout = ops.find((o) => o.path === "src/app/layout.tsx");
    expect(layout, "layout.tsx must be parsed as its own op").toBeDefined();

    // The bug: layout.tsx's newContent would contain the next file's
    // `++ b/src/app/globals.css` header line (parse-diff strips ONE `+`
    // prefix from `+++ b/path` since it was absorbed as an `add` change)
    // AND the globals.css body content as if they were part of layout.tsx.
    expect(layout!.newContent).not.toContain("b/src/app/globals.css");
    expect(layout!.newContent).not.toContain("body {");
    expect(layout!.newContent).not.toContain("color: red");

    expect(layout!.newContent).toBe(
      "export default function RootLayout({ children }: { children: React.ReactNode }) {\n" +
      "  return (\n" +
      "    <html><body>{children}</body></html>\n" +
      "  );\n" +
      "}\n"
    );

    // File 2 must survive as its own op with its own content.
    const css = ops.find((o) => o.path === "src/app/globals.css");
    expect(css, "globals.css must be parsed as its own op (not swallowed into layout.tsx)").toBeDefined();
    expect(css!.kind).toBe("create");
    expect(css!.newContent).toBe("body {\n  color: red;\n}\n");
  });

  it("also handles the well-formed two-file case (no regression)", () => {
    // Sanity: same shape but with a correctly-declared count and full
    // headers on both files. Must continue to round-trip cleanly.
    const diff =
      "diff --git a/src/app/layout.tsx b/src/app/layout.tsx\n" +
      "new file mode 100644\n" +
      "--- /dev/null\n" +
      "+++ b/src/app/layout.tsx\n" +
      "@@ -0,0 +1,3 @@\n" +
      "+export default function Layout() {\n" +
      "+  return <html><body /></html>;\n" +
      "+}\n" +
      "diff --git a/src/app/globals.css b/src/app/globals.css\n" +
      "new file mode 100644\n" +
      "--- /dev/null\n" +
      "+++ b/src/app/globals.css\n" +
      "@@ -0,0 +1,3 @@\n" +
      "+body {\n" +
      "+  color: red;\n" +
      "+}\n";

    const { ops } = parseDiff(diff);
    expect(ops.map((o) => o.path)).toEqual(["src/app/layout.tsx", "src/app/globals.css"]);
    expect(ops[0]!.newContent).toBe(
      "export default function Layout() {\n  return <html><body /></html>;\n}\n"
    );
    expect(ops[1]!.newContent).toBe("body {\n  color: red;\n}\n");
  });
});
