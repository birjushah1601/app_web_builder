/**
 * Plan Q — canned developer-output diff used by DemoDeveloperRole when
 * ATLAS_FF_DEMO_MODE=true. Targets the atlas-next-ts E2B template's default
 * dev-server entry: `src/app/page.tsx`.
 *
 * The diff is intentionally simple (single file, useState-only TODO app)
 * so:
 *   1. Sandbox apply runs cleanly (one file, no external deps).
 *   2. Next.js HMR refreshes the iframe within ~3s of write.
 *   3. Plan I security gate has nothing to flag (no secrets, no fetch, no
 *      dynamic imports). a11y gate may flag the input's missing label —
 *      which is GOOD: it exercises Plan L's auto-fix loop in demo mode.
 *
 * This file's contents are deterministic — refining a demo ritual returns
 * the same diff each time. That's expected: demo mode is for testing the
 * UX plumbing, not the model's iteration ability.
 */

export const CANNED_DEMO_DIFF = `diff --git a/src/app/page.tsx b/src/app/page.tsx
--- a/src/app/page.tsx
+++ b/src/app/page.tsx
@@ -1,10 +1,52 @@
-export default function Home() {
-  return (
-    <main>
-      <h1>Welcome to Atlas Sandbox</h1>
-      <p>This is the default page. Click Send in the chat to build something.</p>
-    </main>
-  );
-}
+"use client";
+
+import { useState } from "react";
+
+interface Todo {
+  id: number;
+  text: string;
+  done: boolean;
+}
+
+export default function Home() {
+  const [todos, setTodos] = useState<Todo[]>([]);
+  const [draft, setDraft] = useState("");
+
+  const add = () => {
+    if (!draft.trim()) return;
+    setTodos((t) => [...t, { id: Date.now(), text: draft.trim(), done: false }]);
+    setDraft("");
+  };
+
+  return (
+    <main style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "system-ui, sans-serif" }}>
+      <h1 style={{ marginBottom: "1rem" }}>Atlas TODO (demo)</h1>
+      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
+        <input
+          type="text"
+          value={draft}
+          onChange={(e) => setDraft(e.target.value)}
+          onKeyDown={(e) => e.key === "Enter" && add()}
+          placeholder="What needs doing?"
+          aria-label="New todo"
+          style={{ flex: 1, padding: "0.5rem", border: "1px solid #cbd5e1", borderRadius: 4 }}
+        />
+        <button onClick={add} style={{ padding: "0.5rem 1rem", background: "#0f172a", color: "white", border: 0, borderRadius: 4 }}>
+          Add
+        </button>
+      </div>
+      <ul style={{ listStyle: "none", padding: 0 }}>
+        {todos.map((t) => (
+          <li key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem 0", borderBottom: "1px solid #e2e8f0" }}>
+            <span style={{ textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
+            <button
+              onClick={() => setTodos((all) => all.filter((x) => x.id !== t.id))}
+              style={{ background: "transparent", border: 0, color: "#dc2626", cursor: "pointer" }}
+            >
+              Delete
+            </button>
+          </li>
+        ))}
+      </ul>
+      {todos.length === 0 && <p style={{ color: "#64748b" }}>No todos yet — add one above.</p>}
+    </main>
+  );
+}
`;

export const CANNED_DEMO_SUMMARY =
  "Demo mode: scaffolded a single-page TODO app at src/app/page.tsx with add/delete using React useState. No external dependencies. Page is fully accessible apart from the input's optional visible label.";
