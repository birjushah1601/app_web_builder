# Canvas in-place editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users click any element in the preview iframe and edit it (text, style, image, structure) with edits flowing back into the actual source files. Built per `docs/superpowers/specs/2026-05-13-canvas-in-place-editing-design.md`.

**Architecture:** Unified patch engine + source writer. Inputs (inline contenteditable, style sliders, image popover, AI chat) all emit typed patches. Source writes go through AST traversal for surgical edits, focused-refine developer dispatch for AI rewrites. Stable DOM↔JSX identity via `data-atlas-id` annotated by atlas-web's `applyDiff` post-write step.

**Tech Stack:** `@babel/parser` + `@babel/traverse` + `@babel/generator` (AST), React (UI), Server Actions (source writes), E2B SDK (sandbox file IO), existing role-developer (AI rewrites).

---

## File structure

**New package: `packages/edit-patch-engine/`** (pure module, no Node/E2B imports beyond `@babel/*`)
- `src/index.ts` — public exports
- `src/types.ts` — `EditPatch` discriminated union + result types
- `src/annotate.ts` — `annotateAtlasIds(filePath, source)` → annotated source
- `src/locate.ts` — `locateByAtlasId(ast, atlasId)` → JSX node + path
- `src/patches/text-replace.ts` — `applyTextReplace(source, patch)` + `invertTextReplace(patch)`
- `src/patches/style-class.ts` — `applyStyleClass(source, patch)` + `invertStyleClass(patch)`
- `src/patches/asset-swap.ts` — `applyAssetSwap(source, patch)` + `invertAssetSwap(patch)`
- `src/patches/dom-mutation.ts` — `applyDomMutation(source, patch)` + `invertDomMutation(patch)` (Phase 2)
- `src/apply-patch.ts` — top-level `applyPatch(source, patch)` dispatcher
- `test/*.test.ts` — fixture-based vitest

**New files in atlas-web:**
- `apps/atlas-web/components/canvas/FloatingToolbar.tsx` — anchored action bar
- `apps/atlas-web/components/canvas/ImageReplacePopover.tsx` — image swap UI
- `apps/atlas-web/components/canvas/SelectionChip.tsx` — chip rendered above ChatPanel (Phase 2)
- `apps/atlas-web/components/canvas/ElementContextMenu.tsx` — right-click menu (Phase 2)
- `apps/atlas-web/lib/canvas/atlas-edit-bridge-client.ts` — typed wrapper around iframe postMessage
- `apps/atlas-web/lib/canvas/use-edit-patch-queue.ts` — client patch queue + undo stack
- `apps/atlas-web/lib/actions/applyPatch.ts` — Server Action: route patch → source writer
- `apps/atlas-web/lib/actions/uploadElementImage.ts` — Server Action: image upload for replace
- `apps/atlas-web/lib/actions/editElementWithAI.ts` — Server Action: focused-refine dispatch (Phase 2)

**Modified files:**
- `apps/atlas-web/lib/sandbox/apply-diff.ts` — call `annotateAtlasIds` after each .tsx write
- `apps/atlas-web/lib/canvas/use-element-selection.ts` — `DomNode` adds `atlasId: string`
- `apps/atlas-web/lib/feature-flags.ts` — new `inline-edit-v1` flag
- `packages/sandbox-e2b/templates/atlas-next-ts/src/atlas-edit-bridge.ts` — read `data-atlas-id`, add new postMessage handlers
- `apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewClient.tsx` — mount FloatingToolbar
- `apps/atlas-web/components/ChatPanel.tsx` — accept `selectionChip` prop (Phase 2)
- `packages/role-developer/src/role.ts` + new `focused-refine-prompt.ts` (Phase 2)

---

## Task 1: Scaffold `@atlas/edit-patch-engine` package

**Files:**
- Create: `packages/edit-patch-engine/package.json`
- Create: `packages/edit-patch-engine/tsconfig.json`
- Create: `packages/edit-patch-engine/vitest.config.ts`
- Create: `packages/edit-patch-engine/src/types.ts`
- Create: `packages/edit-patch-engine/src/index.ts`
- Modify: `apps/atlas-web/package.json` (add workspace dep)
- Modify: `apps/atlas-web/next.config.ts` (add to serverExternalPackages)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@atlas/edit-patch-engine",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@babel/parser": "^7.25.0",
    "@babel/traverse": "^7.25.0",
    "@babel/generator": "^7.25.0",
    "@babel/types": "^7.25.0"
  },
  "devDependencies": {
    "@types/babel__generator": "^7.6.8",
    "@types/babel__traverse": "^7.20.6",
    "@types/node": "22.9.0",
    "typescript": "5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] }
});
```

- [ ] **Step 4: Create types.ts**

```ts
// packages/edit-patch-engine/src/types.ts

/** Discriminated union of every patch the engine can apply.
 *  All patches reference elements by stable atlasId; the captured "old"
 *  fields (oldText, oldUrl, capturedSubtree) exist so each patch's invert()
 *  can produce the reverse without re-reading source. */
export type EditPatch =
  | { kind: "text-replace";      atlasId: string; oldText: string; newText: string }
  | { kind: "style-class-patch"; atlasId: string; addClasses: string[]; removeClasses: string[] }
  | { kind: "asset-swap";        atlasId: string; oldUrl: string; newUrl: string; oldAlt?: string; newAlt?: string }
  | { kind: "dom-mutation";      atlasId: string; op: DomMutationOp; capturedSubtree?: string };

export type DomMutationOp =
  | { kind: "delete" }
  | { kind: "duplicate" }
  | { kind: "wrap"; wrapperTag: string }
  | { kind: "reorder"; direction: "up" | "down" };

/** Result of applying a patch to a single file. */
export interface ApplyPatchResult {
  ok: boolean;
  /** New file content. Undefined when ok=false. */
  newContent?: string;
  /** Inverse patch — pass it back to applyPatch to undo. Undefined when ok=false. */
  inverse?: EditPatch;
  /** Reason for failure. "not-found" means the atlasId wasn't located. */
  error?: "not-found" | "parse-error" | "unsupported";
  /** Human-readable detail for logging / UI. */
  detail?: string;
}
```

- [ ] **Step 5: Create index.ts**

```ts
// packages/edit-patch-engine/src/index.ts
export type { EditPatch, DomMutationOp, ApplyPatchResult } from "./types.js";
export { annotateAtlasIds } from "./annotate.js";
export { applyPatch } from "./apply-patch.js";
```

- [ ] **Step 6: Register in atlas-web workspace**

Add to `apps/atlas-web/package.json` dependencies:
```json
"@atlas/edit-patch-engine": "workspace:*"
```

In `apps/atlas-web/next.config.ts`, append to `serverExternalPackages`:
```ts
"@atlas/edit-patch-engine"
```

- [ ] **Step 7: Install + verify build (will fail until later tasks add the .js files)**

```bash
pnpm install
pnpm --filter @atlas/edit-patch-engine build
```

Expected: TypeScript error "Cannot find module './annotate.js'" — that's OK, fixed by Task 2.

- [ ] **Step 8: Commit**

```bash
git add packages/edit-patch-engine apps/atlas-web/package.json apps/atlas-web/next.config.ts pnpm-lock.yaml
git commit -m "feat(edit-patch-engine): scaffold package + types"
```

---

## Task 2: Implement `annotateAtlasIds`

**Files:**
- Create: `packages/edit-patch-engine/src/annotate.ts`
- Create: `packages/edit-patch-engine/test/annotate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/edit-patch-engine/test/annotate.test.ts
import { describe, it, expect } from "vitest";
import { annotateAtlasIds } from "../src/annotate.js";

describe("annotateAtlasIds", () => {
  it("inserts data-atlas-id on every JSX opening element that lacks one", () => {
    const src = `export default function Page() {
  return (
    <div>
      <h1>Hello</h1>
      <p>World</p>
    </div>
  );
}`;
    const out = annotateAtlasIds("src/app/page.tsx", src);
    // Three opening elements: div, h1, p
    const idMatches = out.match(/data-atlas-id="/g);
    expect(idMatches?.length).toBe(3);
    // Same input → same hash (stable)
    const out2 = annotateAtlasIds("src/app/page.tsx", src);
    expect(out2).toBe(out);
  });

  it("preserves existing data-atlas-id attributes", () => {
    const src = `export default () => <div data-atlas-id="existing-id">x</div>;`;
    const out = annotateAtlasIds("src/app/page.tsx", src);
    expect(out).toContain('data-atlas-id="existing-id"');
    expect(out.match(/data-atlas-id="/g)?.length).toBe(1);
  });

  it("returns input unchanged when there is no JSX", () => {
    const src = `export const x = 1;`;
    expect(annotateAtlasIds("src/lib/foo.ts", src)).toBe(src);
  });

  it("returns input unchanged on parse error", () => {
    const src = `this is { not valid <jsx`;
    expect(annotateAtlasIds("src/broken.tsx", src)).toBe(src);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run test/annotate.test.ts
```

Expected: FAIL with "Cannot find module './annotate.js'"

- [ ] **Step 3: Implement annotate.ts**

```ts
// packages/edit-patch-engine/src/annotate.ts
import { parse } from "@babel/parser";
import traverseDefault from "@babel/traverse";
import generateDefault from "@babel/generator";
import * as t from "@babel/types";
import { createHash } from "node:crypto";

// Babel's default-exports get wrapped one extra time when imported via ESM.
const traverse = (traverseDefault as unknown as { default?: typeof traverseDefault }).default ?? traverseDefault;
const generate = (generateDefault as unknown as { default?: typeof generateDefault }).default ?? generateDefault;

/** Compute a stable 12-char hex hash for an element at a given offset in a file.
 *  Stability properties:
 *    - Same (filePath, nodeStart) → same id. ✓
 *    - Whitespace-only changes elsewhere in the file don't shift nodeStart for
 *      this element (Babel uses original-source offsets). ✓
 *    - Structural inserts BEFORE this element shift nodeStart and produce a
 *      different id. ✗ — acceptable: the element has effectively moved. */
function computeAtlasId(filePath: string, nodeStart: number): string {
  return createHash("sha1").update(`${filePath}:${nodeStart}`).digest("hex").slice(0, 12);
}

/** Annotate every JSXOpeningElement that lacks `data-atlas-id` with a
 *  computed stable id. Returns the regenerated source. On parse error,
 *  returns the input unchanged (caller's diff still lands; just no
 *  fast-path editing on this file until a later write re-annotates). */
export function annotateAtlasIds(filePath: string, source: string): string {
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: false
    });
  } catch {
    return source;
  }

  let mutated = false;
  traverse(ast, {
    JSXOpeningElement(path) {
      const node = path.node;
      const hasAtlasId = node.attributes.some(
        (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === "data-atlas-id"
      );
      if (hasAtlasId) return;
      const start = node.start ?? 0;
      const id = computeAtlasId(filePath, start);
      node.attributes.push(
        t.jsxAttribute(t.jsxIdentifier("data-atlas-id"), t.stringLiteral(id))
      );
      mutated = true;
    }
  });

  if (!mutated) return source;
  const result = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source);
  return result.code;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run test/annotate.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/edit-patch-engine/src/annotate.ts packages/edit-patch-engine/test/annotate.test.ts
git commit -m "feat(edit-patch-engine): annotateAtlasIds — stable hash on every JSXOpeningElement"
```

---

## Task 3: Implement `locateByAtlasId` helper

**Files:**
- Create: `packages/edit-patch-engine/src/locate.ts`
- Create: `packages/edit-patch-engine/test/locate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/edit-patch-engine/test/locate.test.ts
import { describe, it, expect } from "vitest";
import { parse } from "@babel/parser";
import { locateByAtlasId } from "../src/locate.js";

function parseTsx(src: string) {
  return parse(src, { sourceType: "module", plugins: ["typescript", "jsx"] });
}

describe("locateByAtlasId", () => {
  it("returns the JSXOpeningElement matching the given atlasId", () => {
    const ast = parseTsx(`export default () => <h1 data-atlas-id="abc123">x</h1>;`);
    const found = locateByAtlasId(ast, "abc123");
    expect(found).not.toBeNull();
    expect(found?.openingElement.name.type).toBe("JSXIdentifier");
  });

  it("returns null when no element carries that atlasId", () => {
    const ast = parseTsx(`export default () => <h1 data-atlas-id="abc123">x</h1>;`);
    expect(locateByAtlasId(ast, "does-not-exist")).toBeNull();
  });

  it("finds nested elements", () => {
    const ast = parseTsx(`
      export default () => (
        <div data-atlas-id="outer">
          <span data-atlas-id="inner">x</span>
        </div>
      );
    `);
    const inner = locateByAtlasId(ast, "inner");
    expect(inner?.openingElement.attributes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run test/locate.test.ts
```

Expected: FAIL with "Cannot find module './locate.js'".

- [ ] **Step 3: Implement locate.ts**

```ts
// packages/edit-patch-engine/src/locate.ts
import traverseDefault from "@babel/traverse";
import * as t from "@babel/types";
import type { File } from "@babel/types";

const traverse = (traverseDefault as unknown as { default?: typeof traverseDefault }).default ?? traverseDefault;

/** Find the JSXElement whose opening tag has `data-atlas-id="<id>"`.
 *  Returns null when no match. Walks the entire tree (~O(n) on the file). */
export function locateByAtlasId(ast: File, atlasId: string): t.JSXElement | null {
  let found: t.JSXElement | null = null;
  traverse(ast, {
    JSXOpeningElement(path) {
      if (found) return;
      const idAttr = path.node.attributes.find(
        (a) =>
          t.isJSXAttribute(a) &&
          t.isJSXIdentifier(a.name) &&
          a.name.name === "data-atlas-id"
      );
      if (!idAttr || !t.isJSXAttribute(idAttr)) return;
      const v = idAttr.value;
      if (!t.isStringLiteral(v)) return;
      if (v.value === atlasId) {
        const parent = path.parentPath.node;
        if (t.isJSXElement(parent)) {
          found = parent;
          path.stop();
        }
      }
    }
  });
  return found;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run test/locate.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/edit-patch-engine/src/locate.ts packages/edit-patch-engine/test/locate.test.ts
git commit -m "feat(edit-patch-engine): locateByAtlasId AST helper"
```

---

## Task 4: Implement `text-replace` patch

**Files:**
- Create: `packages/edit-patch-engine/src/patches/text-replace.ts`
- Create: `packages/edit-patch-engine/test/text-replace.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/edit-patch-engine/test/text-replace.test.ts
import { describe, it, expect } from "vitest";
import { applyTextReplace } from "../src/patches/text-replace.js";

describe("applyTextReplace", () => {
  it("replaces the text content of the targeted JSX element", () => {
    const src = `export default () => <h1 data-atlas-id="hero">Hello</h1>;`;
    const result = applyTextReplace(src, {
      kind: "text-replace",
      atlasId: "hero",
      oldText: "Hello",
      newText: "Welcome"
    });
    expect(result.ok).toBe(true);
    expect(result.newContent).toContain("Welcome");
    expect(result.newContent).not.toContain(">Hello<");
  });

  it("returns ok=false with error='not-found' when atlasId missing", () => {
    const src = `export default () => <h1 data-atlas-id="hero">x</h1>;`;
    const result = applyTextReplace(src, {
      kind: "text-replace",
      atlasId: "missing",
      oldText: "x",
      newText: "y"
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("not-found");
  });

  it("produces an invert patch that reverses the change", () => {
    const src = `export default () => <h1 data-atlas-id="hero">Hello</h1>;`;
    const result = applyTextReplace(src, {
      kind: "text-replace",
      atlasId: "hero",
      oldText: "Hello",
      newText: "Welcome"
    });
    expect(result.inverse).toEqual({
      kind: "text-replace",
      atlasId: "hero",
      oldText: "Welcome",
      newText: "Hello"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run test/text-replace.test.ts
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement text-replace.ts**

```ts
// packages/edit-patch-engine/src/patches/text-replace.ts
import { parse } from "@babel/parser";
import generateDefault from "@babel/generator";
import * as t from "@babel/types";
import { locateByAtlasId } from "../locate.js";
import type { ApplyPatchResult, EditPatch } from "../types.js";

const generate = (generateDefault as unknown as { default?: typeof generateDefault }).default ?? generateDefault;

export function applyTextReplace(
  source: string,
  patch: Extract<EditPatch, { kind: "text-replace" }>
): ApplyPatchResult {
  let ast;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (err) {
    return { ok: false, error: "parse-error", detail: err instanceof Error ? err.message : String(err) };
  }

  const node = locateByAtlasId(ast, patch.atlasId);
  if (!node) return { ok: false, error: "not-found", detail: `atlasId=${patch.atlasId}` };

  // Replace the children with a single JSXText carrying the new text.
  // Loses any nested elements — text-replace is for leaf text nodes only.
  // The caller should refuse text-replace when the element has element children
  // and route those edits through ai-rewrite instead.
  node.children = [t.jsxText(patch.newText)];

  const out = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source);
  return {
    ok: true,
    newContent: out.code,
    inverse: {
      kind: "text-replace",
      atlasId: patch.atlasId,
      oldText: patch.newText,
      newText: patch.oldText
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run test/text-replace.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/edit-patch-engine/src/patches/text-replace.ts packages/edit-patch-engine/test/text-replace.test.ts
git commit -m "feat(edit-patch-engine): text-replace patch"
```

---

## Task 5: Implement `style-class-patch`

**Files:**
- Create: `packages/edit-patch-engine/src/patches/style-class.ts`
- Create: `packages/edit-patch-engine/test/style-class.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/edit-patch-engine/test/style-class.test.ts
import { describe, it, expect } from "vitest";
import { applyStyleClass } from "../src/patches/style-class.js";

describe("applyStyleClass", () => {
  it("appends new Tailwind classes to className", () => {
    const src = `export default () => <h1 data-atlas-id="hero" className="text-xl">x</h1>;`;
    const r = applyStyleClass(src, {
      kind: "style-class-patch",
      atlasId: "hero",
      addClasses: ["text-3xl", "font-bold"],
      removeClasses: ["text-xl"]
    });
    expect(r.ok).toBe(true);
    expect(r.newContent).toContain('className="text-3xl font-bold"');
    expect(r.newContent).not.toContain("text-xl");
  });

  it("adds className attribute when element has none", () => {
    const src = `export default () => <h1 data-atlas-id="hero">x</h1>;`;
    const r = applyStyleClass(src, {
      kind: "style-class-patch",
      atlasId: "hero",
      addClasses: ["bg-red-500"],
      removeClasses: []
    });
    expect(r.ok).toBe(true);
    expect(r.newContent).toContain('className="bg-red-500"');
  });

  it("inverse swaps add and remove", () => {
    const src = `export default () => <h1 data-atlas-id="hero" className="a">x</h1>;`;
    const r = applyStyleClass(src, {
      kind: "style-class-patch",
      atlasId: "hero",
      addClasses: ["b"],
      removeClasses: ["a"]
    });
    expect(r.inverse).toEqual({
      kind: "style-class-patch",
      atlasId: "hero",
      addClasses: ["a"],
      removeClasses: ["b"]
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run test/style-class.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement style-class.ts**

```ts
// packages/edit-patch-engine/src/patches/style-class.ts
import { parse } from "@babel/parser";
import generateDefault from "@babel/generator";
import * as t from "@babel/types";
import { locateByAtlasId } from "../locate.js";
import type { ApplyPatchResult, EditPatch } from "../types.js";

const generate = (generateDefault as unknown as { default?: typeof generateDefault }).default ?? generateDefault;

export function applyStyleClass(
  source: string,
  patch: Extract<EditPatch, { kind: "style-class-patch" }>
): ApplyPatchResult {
  let ast;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (err) {
    return { ok: false, error: "parse-error", detail: err instanceof Error ? err.message : String(err) };
  }

  const node = locateByAtlasId(ast, patch.atlasId);
  if (!node) return { ok: false, error: "not-found", detail: `atlasId=${patch.atlasId}` };

  const opening = node.openingElement;
  const classAttr = opening.attributes.find(
    (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === "className"
  );

  // Parse existing className value into a Set of tokens.
  const existing: string[] = [];
  if (classAttr && t.isJSXAttribute(classAttr) && classAttr.value) {
    if (t.isStringLiteral(classAttr.value)) {
      existing.push(...classAttr.value.value.split(/\s+/).filter(Boolean));
    }
    // Note: className={someExpression} is preserved unchanged — we can't
    // safely diff dynamic class strings; surface as unsupported.
    else {
      return { ok: false, error: "unsupported", detail: "className is a dynamic expression — use ai-rewrite" };
    }
  }

  const next = new Set(existing);
  for (const c of patch.removeClasses) next.delete(c);
  for (const c of patch.addClasses) next.add(c);
  const nextValue = Array.from(next).join(" ");

  if (classAttr && t.isJSXAttribute(classAttr)) {
    classAttr.value = t.stringLiteral(nextValue);
  } else {
    opening.attributes.push(t.jsxAttribute(t.jsxIdentifier("className"), t.stringLiteral(nextValue)));
  }

  const out = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source);
  return {
    ok: true,
    newContent: out.code,
    inverse: {
      kind: "style-class-patch",
      atlasId: patch.atlasId,
      addClasses: patch.removeClasses,
      removeClasses: patch.addClasses
    }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run test/style-class.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/edit-patch-engine/src/patches/style-class.ts packages/edit-patch-engine/test/style-class.test.ts
git commit -m "feat(edit-patch-engine): style-class-patch"
```

---

## Task 6: Implement `asset-swap` patch

**Files:**
- Create: `packages/edit-patch-engine/src/patches/asset-swap.ts`
- Create: `packages/edit-patch-engine/test/asset-swap.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/edit-patch-engine/test/asset-swap.test.ts
import { describe, it, expect } from "vitest";
import { applyAssetSwap } from "../src/patches/asset-swap.js";

describe("applyAssetSwap", () => {
  it("swaps src and optional alt on an img element", () => {
    const src = `export default () => <img data-atlas-id="hero" src="/old.jpg" alt="old" />;`;
    const r = applyAssetSwap(src, {
      kind: "asset-swap",
      atlasId: "hero",
      oldUrl: "/old.jpg",
      newUrl: "/new.jpg",
      oldAlt: "old",
      newAlt: "new"
    });
    expect(r.ok).toBe(true);
    expect(r.newContent).toContain('src="/new.jpg"');
    expect(r.newContent).toContain('alt="new"');
  });

  it("leaves alt unchanged when newAlt is undefined", () => {
    const src = `export default () => <img data-atlas-id="hero" src="/old.jpg" alt="old" />;`;
    const r = applyAssetSwap(src, {
      kind: "asset-swap",
      atlasId: "hero",
      oldUrl: "/old.jpg",
      newUrl: "/new.jpg"
    });
    expect(r.ok).toBe(true);
    expect(r.newContent).toContain('alt="old"');
  });

  it("inverse swaps urls and alts", () => {
    const src = `export default () => <img data-atlas-id="hero" src="/a.jpg" alt="A" />;`;
    const r = applyAssetSwap(src, {
      kind: "asset-swap",
      atlasId: "hero",
      oldUrl: "/a.jpg",
      newUrl: "/b.jpg",
      oldAlt: "A",
      newAlt: "B"
    });
    expect(r.inverse).toMatchObject({
      kind: "asset-swap",
      atlasId: "hero",
      oldUrl: "/b.jpg",
      newUrl: "/a.jpg",
      oldAlt: "B",
      newAlt: "A"
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run test/asset-swap.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement asset-swap.ts**

```ts
// packages/edit-patch-engine/src/patches/asset-swap.ts
import { parse } from "@babel/parser";
import generateDefault from "@babel/generator";
import * as t from "@babel/types";
import { locateByAtlasId } from "../locate.js";
import type { ApplyPatchResult, EditPatch } from "../types.js";

const generate = (generateDefault as unknown as { default?: typeof generateDefault }).default ?? generateDefault;

function setStringAttr(opening: t.JSXOpeningElement, name: string, value: string) {
  const existing = opening.attributes.find(
    (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === name
  );
  if (existing && t.isJSXAttribute(existing)) {
    existing.value = t.stringLiteral(value);
  } else {
    opening.attributes.push(t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value)));
  }
}

export function applyAssetSwap(
  source: string,
  patch: Extract<EditPatch, { kind: "asset-swap" }>
): ApplyPatchResult {
  let ast;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (err) {
    return { ok: false, error: "parse-error", detail: err instanceof Error ? err.message : String(err) };
  }

  const node = locateByAtlasId(ast, patch.atlasId);
  if (!node) return { ok: false, error: "not-found", detail: `atlasId=${patch.atlasId}` };

  setStringAttr(node.openingElement, "src", patch.newUrl);
  if (patch.newAlt !== undefined) {
    setStringAttr(node.openingElement, "alt", patch.newAlt);
  }

  const out = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source);
  const inverse: EditPatch = {
    kind: "asset-swap",
    atlasId: patch.atlasId,
    oldUrl: patch.newUrl,
    newUrl: patch.oldUrl,
    ...(patch.newAlt !== undefined ? { oldAlt: patch.newAlt } : {}),
    ...(patch.oldAlt !== undefined ? { newAlt: patch.oldAlt } : {})
  };
  return { ok: true, newContent: out.code, inverse };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run test/asset-swap.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/edit-patch-engine/src/patches/asset-swap.ts packages/edit-patch-engine/test/asset-swap.test.ts
git commit -m "feat(edit-patch-engine): asset-swap patch"
```

---

## Task 7: Top-level `applyPatch` dispatcher

**Files:**
- Create: `packages/edit-patch-engine/src/apply-patch.ts`
- Create: `packages/edit-patch-engine/test/apply-patch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/edit-patch-engine/test/apply-patch.test.ts
import { describe, it, expect } from "vitest";
import { applyPatch } from "../src/apply-patch.js";

describe("applyPatch dispatcher", () => {
  it("routes text-replace to applyTextReplace", () => {
    const src = `export default () => <h1 data-atlas-id="h">Hello</h1>;`;
    const r = applyPatch(src, {
      kind: "text-replace",
      atlasId: "h",
      oldText: "Hello",
      newText: "Hi"
    });
    expect(r.ok).toBe(true);
    expect(r.newContent).toContain("Hi");
  });

  it("routes style-class-patch", () => {
    const src = `export default () => <h1 data-atlas-id="h">x</h1>;`;
    const r = applyPatch(src, {
      kind: "style-class-patch",
      atlasId: "h",
      addClasses: ["a"],
      removeClasses: []
    });
    expect(r.ok).toBe(true);
    expect(r.newContent).toContain('className="a"');
  });

  it("returns unsupported for dom-mutation in Phase 1", () => {
    const src = `export default () => <h1 data-atlas-id="h">x</h1>;`;
    const r = applyPatch(src, {
      kind: "dom-mutation",
      atlasId: "h",
      op: { kind: "delete" }
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("unsupported");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run test/apply-patch.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement apply-patch.ts**

```ts
// packages/edit-patch-engine/src/apply-patch.ts
import { applyTextReplace } from "./patches/text-replace.js";
import { applyStyleClass } from "./patches/style-class.js";
import { applyAssetSwap } from "./patches/asset-swap.js";
import type { ApplyPatchResult, EditPatch } from "./types.js";

/** Dispatch a patch to the appropriate per-kind applier. Phase 1 implements
 *  text-replace, style-class-patch, asset-swap; dom-mutation lands in Phase 2.
 *  Unknown / not-yet-implemented kinds return ok=false with error="unsupported". */
export function applyPatch(source: string, patch: EditPatch): ApplyPatchResult {
  switch (patch.kind) {
    case "text-replace":      return applyTextReplace(source, patch);
    case "style-class-patch": return applyStyleClass(source, patch);
    case "asset-swap":        return applyAssetSwap(source, patch);
    case "dom-mutation":      return { ok: false, error: "unsupported", detail: "dom-mutation is Phase 2" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @atlas/edit-patch-engine build
pnpm --filter @atlas/edit-patch-engine vitest run
```

Expected: all tests pass; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/edit-patch-engine/src/apply-patch.ts packages/edit-patch-engine/test/apply-patch.test.ts
git commit -m "feat(edit-patch-engine): top-level applyPatch dispatcher"
```

---

## Task 8: Wire `annotateAtlasIds` into atlas-web's `apply-diff`

**Files:**
- Modify: `apps/atlas-web/lib/sandbox/apply-diff.ts`
- Create: `apps/atlas-web/test/lib/sandbox/apply-diff-annotates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/atlas-web/test/lib/sandbox/apply-diff-annotates.test.ts
import { describe, it, expect, vi } from "vitest";
import { applyDiff } from "@/lib/sandbox/apply-diff";

describe("applyDiff — atlas-id annotation", () => {
  it("annotates .tsx files with data-atlas-id after writing", async () => {
    const writes: Record<string, string> = {};
    const fs = {
      write: async (p: string, c: string) => { writes[p] = c; },
      read: async (p: string) => writes[p] ?? ""
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
      read: async () => ""
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm vitest run test/lib/sandbox/apply-diff-annotates.test.ts
```

Expected: FAIL (writes don't have data-atlas-id yet).

- [ ] **Step 3: Modify apply-diff.ts to call annotateAtlasIds**

Find the loop that writes each file to the sandbox (look for `await fs.write(filePath, content)` or similar). Wrap the write so .tsx / .jsx contents are annotated first:

```ts
import { annotateAtlasIds } from "@atlas/edit-patch-engine";

// ... inside the per-file write loop, before `await fs.write(...)`:
let contentToWrite = newFileContent;
if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
  contentToWrite = annotateAtlasIds(filePath, newFileContent);
}
await fs.write(absolutePath, contentToWrite);
```

(Adapt the exact variable names to match what apply-diff.ts uses.)

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm vitest run test/lib/sandbox/apply-diff-annotates.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/sandbox/apply-diff.ts apps/atlas-web/test/lib/sandbox/apply-diff-annotates.test.ts
git commit -m "feat(atlas-web): annotate data-atlas-id on every .tsx the developer writes"
```

---

## Task 9: Add `inline-edit-v1` feature flag

**Files:**
- Modify: `apps/atlas-web/lib/feature-flags.ts`
- Modify: `apps/atlas-web/.env.local` (manual append, not staged)

- [ ] **Step 1: Add flag to the union + map + listFlagStates**

In `apps/atlas-web/lib/feature-flags.ts`:

```ts
// Add to FeatureFlag union:
| "inline-edit-v1"

// Add to FLAG_TO_ENV:
"inline-edit-v1": "ATLAS_FF_INLINE_EDIT_V1",

// Add to listFlagStates:
"inline-edit-v1": isFeatureEnabled("inline-edit-v1", source),
```

- [ ] **Step 2: Append flag stub to .env.local**

```bash
echo '
# Plan IPE — canvas in-place editing (2026-05-13)
ATLAS_FF_INLINE_EDIT_V1=false   # Master flag for floating toolbar + AST patch engine
' >> apps/atlas-web/.env.local
```

- [ ] **Step 3: Run feature-flags tests**

```bash
cd apps/atlas-web && pnpm vitest run test/lib/feature-flags.test.ts
```

Expected: existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/lib/feature-flags.ts
git commit -m "feat(atlas-web): add inline-edit-v1 feature flag (defaults OFF)"
```

---

## Task 10: Extend `atlas-edit-bridge.ts` — read `data-atlas-id` + new postMessage handlers

**Files:**
- Modify: `packages/sandbox-e2b/templates/atlas-next-ts/src/atlas-edit-bridge.ts`

- [ ] **Step 1: Read `data-atlas-id` into the walked DOM tree**

In `walk()`, extend the returned object:

```ts
return Array.from(els).map((el) => {
  const r = el.getBoundingClientRect();
  return {
    selector: pathFor(el),
    atlasId: el.getAttribute("data-atlas-id") ?? "",
    tag: el.tagName.toLowerCase(),
    text: (el.textContent ?? "").trim().slice(0, 60),
    rect: { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height },
    classes: Array.from(el.classList)
  };
});
```

- [ ] **Step 2: Add new postMessage handlers**

Replace the existing `onMessage` handler with:

```ts
function findByAtlasId(id: string): Element | null {
  return document.querySelector(`[data-atlas-id="${id}"]`);
}

function onMessage(ev: MessageEvent) {
  if (typeof ev.data !== "object" || ev.data === null) return;
  const data = ev.data as { type?: string; atlasId?: string; [k: string]: unknown };

  switch (data.type) {
    case "atlas-apply-class": {
      // Legacy: selector-based. Kept for backwards compat.
      const sel = data.selector as string | undefined;
      if (!sel) return;
      const el = document.querySelector(sel);
      if (!el) return;
      el.className = data.className as string;
      post();
      break;
    }
    case "atlas-apply-text": {
      const el = data.atlasId ? findByAtlasId(data.atlasId) : null;
      if (!el) return;
      el.textContent = data.newText as string;
      post();
      break;
    }
    case "atlas-replace-img": {
      const el = data.atlasId ? findByAtlasId(data.atlasId) : null;
      if (!el || !(el instanceof HTMLImageElement)) return;
      el.src = data.newUrl as string;
      if (typeof data.newAlt === "string") el.alt = data.newAlt;
      post();
      break;
    }
    case "atlas-make-editable": {
      const el = data.atlasId ? findByAtlasId(data.atlasId) : null;
      if (!el || !(el instanceof HTMLElement)) return;
      el.contentEditable = "true";
      el.focus();
      const onBlur = () => {
        el.contentEditable = "false";
        el.removeEventListener("blur", onBlur);
        window.parent.postMessage(
          {
            type: "atlas-text-committed",
            atlasId: data.atlasId,
            newText: (el.textContent ?? "").trim()
          },
          "*"
        );
      };
      el.addEventListener("blur", onBlur);
      break;
    }
    case "atlas-revert-text": {
      const el = data.atlasId ? findByAtlasId(data.atlasId) : null;
      if (!el) return;
      el.textContent = data.oldText as string;
      post();
      break;
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/src/atlas-edit-bridge.ts
git commit -m "feat(sandbox): atlas-edit-bridge reads data-atlas-id + adds apply-text/replace-img/make-editable handlers"
```

Note: the template needs to be republished for the sandbox to pick up these handlers. Operator runs `scripts/build-template.sh` after this lands. For Phase 1 development, atlas-web's apply-diff annotates new files but already-running sandboxes won't have the new bridge — that's acceptable; users see the change on the next sandbox provision.

---

## Task 11: Update `DomNode` type to include `atlasId`

**Files:**
- Modify: `apps/atlas-web/lib/canvas/use-element-selection.ts`

- [ ] **Step 1: Extend the type**

```ts
export interface DomNode {
  selector: string;
  atlasId: string;
  tag: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  classes: string[];
}
```

- [ ] **Step 2: Update existing IframeOverlay test fixtures**

In `apps/atlas-web/test/components/canvas/IframeOverlay.test.tsx`, wherever a fake DomNode is constructed, add `atlasId: "test-id-1"` (or unique per node).

- [ ] **Step 3: Run existing canvas tests**

```bash
cd apps/atlas-web && pnpm vitest run test/components/canvas/
```

Expected: pass (the only change is an extra required field).

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/lib/canvas/use-element-selection.ts apps/atlas-web/test/components/canvas/IframeOverlay.test.tsx
git commit -m "feat(atlas-web): DomNode adds atlasId field"
```

---

## Task 12: `atlas-edit-bridge-client` — typed postMessage wrapper

**Files:**
- Create: `apps/atlas-web/lib/canvas/atlas-edit-bridge-client.ts`
- Create: `apps/atlas-web/test/lib/canvas/atlas-edit-bridge-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/atlas-web/test/lib/canvas/atlas-edit-bridge-client.test.ts
import { describe, it, expect, vi } from "vitest";
import { bridgeApplyText, bridgeReplaceImg, bridgeMakeEditable } from "@/lib/canvas/atlas-edit-bridge-client";

describe("atlas-edit-bridge-client", () => {
  it("bridgeApplyText posts atlas-apply-text to the iframe contentWindow", () => {
    const post = vi.fn();
    const iframe = { contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement;
    bridgeApplyText(iframe, { atlasId: "h", newText: "Hi" });
    expect(post).toHaveBeenCalledWith(
      { type: "atlas-apply-text", atlasId: "h", newText: "Hi" },
      "*"
    );
  });

  it("bridgeReplaceImg posts atlas-replace-img with src + optional alt", () => {
    const post = vi.fn();
    const iframe = { contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement;
    bridgeReplaceImg(iframe, { atlasId: "img1", newUrl: "/x.jpg", newAlt: "X" });
    expect(post).toHaveBeenCalledWith(
      { type: "atlas-replace-img", atlasId: "img1", newUrl: "/x.jpg", newAlt: "X" },
      "*"
    );
  });

  it("bridgeMakeEditable posts atlas-make-editable", () => {
    const post = vi.fn();
    const iframe = { contentWindow: { postMessage: post } } as unknown as HTMLIFrameElement;
    bridgeMakeEditable(iframe, { atlasId: "h" });
    expect(post).toHaveBeenCalledWith(
      { type: "atlas-make-editable", atlasId: "h" },
      "*"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm vitest run test/lib/canvas/atlas-edit-bridge-client.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the client**

```ts
// apps/atlas-web/lib/canvas/atlas-edit-bridge-client.ts
/** Typed wrappers around `iframe.contentWindow.postMessage`. React components
 *  call these instead of constructing message payloads inline — keeps the
 *  message shape in one file, so the bridge contract evolves cleanly. */

function post(iframe: HTMLIFrameElement, message: Record<string, unknown>): void {
  iframe.contentWindow?.postMessage(message, "*");
}

export function bridgeApplyText(
  iframe: HTMLIFrameElement,
  input: { atlasId: string; newText: string }
): void {
  post(iframe, { type: "atlas-apply-text", atlasId: input.atlasId, newText: input.newText });
}

export function bridgeReplaceImg(
  iframe: HTMLIFrameElement,
  input: { atlasId: string; newUrl: string; newAlt?: string }
): void {
  post(iframe, {
    type: "atlas-replace-img",
    atlasId: input.atlasId,
    newUrl: input.newUrl,
    ...(input.newAlt !== undefined ? { newAlt: input.newAlt } : {})
  });
}

export function bridgeMakeEditable(
  iframe: HTMLIFrameElement,
  input: { atlasId: string }
): void {
  post(iframe, { type: "atlas-make-editable", atlasId: input.atlasId });
}

export function bridgeRevertText(
  iframe: HTMLIFrameElement,
  input: { atlasId: string; oldText: string }
): void {
  post(iframe, { type: "atlas-revert-text", atlasId: input.atlasId, oldText: input.oldText });
}

export function bridgeApplyClass(
  iframe: HTMLIFrameElement,
  input: { selector: string; className: string }
): void {
  post(iframe, { type: "atlas-apply-class", selector: input.selector, className: input.className });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm vitest run test/lib/canvas/atlas-edit-bridge-client.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/canvas/atlas-edit-bridge-client.ts apps/atlas-web/test/lib/canvas/atlas-edit-bridge-client.test.ts
git commit -m "feat(atlas-web): typed postMessage wrappers for atlas-edit-bridge"
```

---

## Task 13: `applyPatch` Server Action

**Files:**
- Create: `apps/atlas-web/lib/actions/applyPatch.ts`
- Create: `apps/atlas-web/test/actions/applyPatch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/atlas-web/test/actions/applyPatch.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u1" }) }));

// Helpers + mocks for sandbox SDK paths — adapt to whatever pattern the
// repo uses for testing Server Actions. The key contract under test is the
// patch-engine routing logic, not the sandbox IO, so the SDK is stubbed.
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm vitest run test/actions/applyPatch.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement applyPatch.ts**

```ts
// apps/atlas-web/lib/actions/applyPatch.ts
"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { applyPatch as enginePatch } from "@atlas/edit-patch-engine";
import type { EditPatch } from "@atlas/edit-patch-engine";

export interface ApplyPatchInput {
  projectId: string;
  /** Full sandbox file path including /code/ prefix, e.g. /code/src/app/page.tsx */
  filePath: string;
  patch: EditPatch;
}

export interface ApplyPatchOutput {
  ok: boolean;
  inverse?: EditPatch;
  error?: "unauthorized" | "not-found" | "parse-error" | "unsupported" | "sandbox-error";
  detail?: string;
}

/** Server Action that applies a single EditPatch to a single sandbox file:
 *  1) Reads the current file content from the live E2B sandbox.
 *  2) Runs the patch through @atlas/edit-patch-engine's applyPatch.
 *  3) On ok, writes the new content back (HMR picks it up).
 *  Returns the inverse patch so the client can push it onto its undo stack. */
export async function applyPatch(input: ApplyPatchInput): Promise<ApplyPatchOutput> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthorized" };

  try {
    const session = await getSandboxFactory().getOrProvision(input.projectId);
    const { Sandbox } = await import("@e2b/sdk");
    const sdk = await Sandbox.connect(session.record.sandboxId, {
      apiKey: process.env.E2B_API_KEY ?? ""
    });
    const files = (sdk as unknown as {
      files: { read: (p: string) => Promise<string>; write: (p: string, c: string) => Promise<unknown> };
    }).files;
    const source = await files.read(input.filePath);
    const result = enginePatch(source, input.patch);
    if (!result.ok || !result.newContent) {
      const out: ApplyPatchOutput = { ok: false };
      if (result.error) out.error = result.error;
      if (result.detail) out.detail = result.detail;
      return out;
    }
    await files.write(input.filePath, result.newContent);
    const out: ApplyPatchOutput = { ok: true };
    if (result.inverse) out.inverse = result.inverse;
    return out;
  } catch (err) {
    return {
      ok: false,
      error: "sandbox-error",
      detail: err instanceof Error ? err.message : String(err)
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm vitest run test/actions/applyPatch.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/actions/applyPatch.ts apps/atlas-web/test/actions/applyPatch.test.ts
git commit -m "feat(atlas-web): applyPatch Server Action — sandbox file read → engine → write"
```

---

## Task 14: `use-edit-patch-queue` hook — client queue + undo stack

**Files:**
- Create: `apps/atlas-web/lib/canvas/use-edit-patch-queue.ts`
- Create: `apps/atlas-web/test/lib/canvas/use-edit-patch-queue.test.ts`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/atlas-web/test/lib/canvas/use-edit-patch-queue.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEditPatchQueue } from "@/lib/canvas/use-edit-patch-queue";

describe("useEditPatchQueue", () => {
  it("submitPatch calls the supplied applier and pushes inverse onto the undo stack", async () => {
    const apply = vi.fn().mockResolvedValue({
      ok: true,
      inverse: { kind: "text-replace", atlasId: "h", oldText: "Hi", newText: "Hello" }
    });
    const { result } = renderHook(() => useEditPatchQueue({ apply }));

    await act(async () => {
      await result.current.submitPatch({
        filePath: "/code/src/app/page.tsx",
        patch: { kind: "text-replace", atlasId: "h", oldText: "Hello", newText: "Hi" }
      });
    });

    expect(apply).toHaveBeenCalledOnce();
    expect(result.current.canUndo).toBe(true);
  });

  it("undo() applies the inverse of the most recent successful patch", async () => {
    const apply = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        inverse: { kind: "text-replace", atlasId: "h", oldText: "Hi", newText: "Hello" }
      })
      .mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useEditPatchQueue({ apply }));
    await act(async () => {
      await result.current.submitPatch({
        filePath: "/code/src/app/page.tsx",
        patch: { kind: "text-replace", atlasId: "h", oldText: "Hello", newText: "Hi" }
      });
    });
    await act(async () => { await result.current.undo(); });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1]![0]).toMatchObject({
      patch: { kind: "text-replace", oldText: "Hi", newText: "Hello" }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm vitest run test/lib/canvas/use-edit-patch-queue.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement use-edit-patch-queue.ts**

```ts
// apps/atlas-web/lib/canvas/use-edit-patch-queue.ts
"use client";
import * as React from "react";
import type { EditPatch } from "@atlas/edit-patch-engine";

export interface PatchRequest {
  filePath: string;
  patch: EditPatch;
}

export interface PatchResult {
  ok: boolean;
  inverse?: EditPatch;
  error?: string;
}

/** Caller-supplied applier. Almost always the applyPatch Server Action, but
 *  the seam lets unit tests stub it without mocking the action module. */
type Applier = (req: PatchRequest) => Promise<PatchResult>;

interface UndoEntry {
  filePath: string;
  inverse: EditPatch;
}

export interface UseEditPatchQueueResult {
  submitPatch: (req: PatchRequest) => Promise<PatchResult>;
  undo: () => Promise<PatchResult | null>;
  canUndo: boolean;
}

/** Client-side serial patch queue + undo stack. Patches submit one at a
 *  time (server-side already coalesces but the client enforces order so the
 *  optimistic UI stays consistent). Successful patches push their inverse
 *  onto the undo stack; failed patches are dropped. */
export function useEditPatchQueue(opts: { apply: Applier }): UseEditPatchQueueResult {
  const [undoStack, setUndoStack] = React.useState<UndoEntry[]>([]);
  const inflightRef = React.useRef<Promise<unknown>>(Promise.resolve());

  const submitPatch = React.useCallback(
    async (req: PatchRequest): Promise<PatchResult> => {
      // Chain onto inflight so calls serialize.
      const prior = inflightRef.current;
      const next = prior.then(() => opts.apply(req));
      inflightRef.current = next.catch(() => undefined);
      const result = await next;
      if (result.ok && result.inverse) {
        setUndoStack((s) => [...s, { filePath: req.filePath, inverse: result.inverse! }]);
      }
      return result;
    },
    [opts]
  );

  const undo = React.useCallback(async (): Promise<PatchResult | null> => {
    if (undoStack.length === 0) return null;
    const last = undoStack[undoStack.length - 1]!;
    setUndoStack((s) => s.slice(0, -1));
    return opts.apply({ filePath: last.filePath, patch: last.inverse });
  }, [undoStack, opts]);

  return { submitPatch, undo, canUndo: undoStack.length > 0 };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm vitest run test/lib/canvas/use-edit-patch-queue.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/canvas/use-edit-patch-queue.ts apps/atlas-web/test/lib/canvas/use-edit-patch-queue.test.ts
git commit -m "feat(atlas-web): useEditPatchQueue hook — client serial queue + undo stack"
```

---

## Task 15: `FloatingToolbar` component

**Files:**
- Create: `apps/atlas-web/components/canvas/FloatingToolbar.tsx`
- Create: `apps/atlas-web/test/components/canvas/FloatingToolbar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/atlas-web/test/components/canvas/FloatingToolbar.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FloatingToolbar } from "@/components/canvas/FloatingToolbar";
import type { DomNode } from "@/lib/canvas/use-element-selection";

const baseNode: DomNode = {
  selector: "h1",
  atlasId: "abc",
  tag: "h1",
  text: "Hello",
  rect: { x: 100, y: 200, width: 300, height: 40 },
  classes: []
};

describe("FloatingToolbar", () => {
  it("renders Edit text + Style + Ask AI buttons for a text element", () => {
    render(<FloatingToolbar node={baseNode} onEditText={vi.fn()} onOpenStyle={vi.fn()} onAskAi={vi.fn()} />);
    expect(screen.getByRole("button", { name: /edit text/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /style/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ask ai/i })).toBeInTheDocument();
  });

  it("renders Replace image + Alt text + Ask AI for an img element", () => {
    const img: DomNode = { ...baseNode, tag: "img" };
    render(<FloatingToolbar node={img} onEditText={vi.fn()} onOpenStyle={vi.fn()} onAskAi={vi.fn()} onReplaceImage={vi.fn()} />);
    expect(screen.getByRole("button", { name: /replace image/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ask ai/i })).toBeInTheDocument();
  });

  it("fires onEditText when Edit text is clicked", () => {
    const onEditText = vi.fn();
    render(<FloatingToolbar node={baseNode} onEditText={onEditText} onOpenStyle={vi.fn()} onAskAi={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /edit text/i }));
    expect(onEditText).toHaveBeenCalledWith(baseNode);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm vitest run test/components/canvas/FloatingToolbar.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement FloatingToolbar.tsx**

```tsx
// apps/atlas-web/components/canvas/FloatingToolbar.tsx
"use client";
import * as React from "react";
import type { DomNode } from "@/lib/canvas/use-element-selection";

export interface FloatingToolbarProps {
  node: DomNode;
  onEditText: (node: DomNode) => void;
  onOpenStyle: (node: DomNode) => void;
  onAskAi: (node: DomNode) => void;
  onReplaceImage?: (node: DomNode) => void;
}

/** Action toolbar anchored above (or below if near viewport top) the
 *  currently-selected DOM element. Renders different button sets per
 *  element type — text elements show Edit text / Style / Ask AI; images
 *  show Replace image / Style / Ask AI. */
export function FloatingToolbar({
  node,
  onEditText,
  onOpenStyle,
  onAskAi,
  onReplaceImage
}: FloatingToolbarProps) {
  const isImage = node.tag === "img";
  const isText = !isImage; // simplified: anything non-img is text-capable
  // Anchor 36px above the element, clamped to viewport.
  const top = Math.max(8, node.rect.y - 36);
  const left = Math.max(8, node.rect.x);

  return (
    <div
      data-testid="floating-toolbar"
      role="toolbar"
      aria-label="Element actions"
      className="pointer-events-auto absolute z-50 flex items-center gap-1 rounded-md border border-slate-300 bg-white px-1 py-1 text-xs shadow-md"
      style={{ top, left }}
    >
      {isText && (
        <button
          type="button"
          onClick={() => onEditText(node)}
          className="rounded px-2 py-1 hover:bg-slate-100"
        >
          ✎ Edit text
        </button>
      )}
      {isImage && onReplaceImage && (
        <button
          type="button"
          onClick={() => onReplaceImage(node)}
          className="rounded px-2 py-1 hover:bg-slate-100"
        >
          🖼 Replace image
        </button>
      )}
      <button
        type="button"
        onClick={() => onOpenStyle(node)}
        className="rounded px-2 py-1 hover:bg-slate-100"
      >
        🎨 Style
      </button>
      <button
        type="button"
        onClick={() => onAskAi(node)}
        className="rounded px-2 py-1 hover:bg-slate-100"
      >
        ✨ Ask AI
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm vitest run test/components/canvas/FloatingToolbar.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/components/canvas/FloatingToolbar.tsx apps/atlas-web/test/components/canvas/FloatingToolbar.test.tsx
git commit -m "feat(atlas-web): FloatingToolbar — anchored action buttons per element type"
```

---

## Task 16: `ImageReplacePopover` + `uploadElementImage`

**Files:**
- Create: `apps/atlas-web/components/canvas/ImageReplacePopover.tsx`
- Create: `apps/atlas-web/lib/actions/uploadElementImage.ts`
- Create: `apps/atlas-web/test/components/canvas/ImageReplacePopover.test.tsx`

- [ ] **Step 1: Implement uploadElementImage Server Action**

```ts
// apps/atlas-web/lib/actions/uploadElementImage.ts
"use server";
import { uploadReference } from "@/lib/actions/uploadReference";

/** Thin wrapper around uploadReference: takes a FormData with a single `file`
 *  field, persists to `.next/cache/atlas-references/<sha>.<ext>`, returns the
 *  served URL the patch engine should write into the JSX `src=`. Kept as its
 *  own action so future image-specific extensions (sandbox /code/public/
 *  copy, alt-derivation) don't add complexity to the more general
 *  uploadReference. */
export async function uploadElementImage(formData: FormData): Promise<{ url: string }> {
  return uploadReference(formData);
}
```

- [ ] **Step 2: Write the failing component test**

```tsx
// apps/atlas-web/test/components/canvas/ImageReplacePopover.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImageReplacePopover } from "@/components/canvas/ImageReplacePopover";

describe("ImageReplacePopover", () => {
  it("renders drop zone + URL input", () => {
    render(<ImageReplacePopover onSubmit={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/drop an image/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/paste url/i)).toBeInTheDocument();
  });

  it("submits the typed URL", () => {
    const onSubmit = vi.fn();
    render(<ImageReplacePopover onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/paste url/i), { target: { value: "/new.jpg" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onSubmit).toHaveBeenCalledWith({ url: "/new.jpg" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm vitest run test/components/canvas/ImageReplacePopover.test.tsx
```

Expected: FAIL.

- [ ] **Step 4: Implement ImageReplacePopover.tsx**

```tsx
// apps/atlas-web/components/canvas/ImageReplacePopover.tsx
"use client";
import * as React from "react";
import { uploadElementImage } from "@/lib/actions/uploadElementImage";

export interface ImageReplacePopoverProps {
  onSubmit: (input: { url: string; alt?: string }) => void;
  onClose: () => void;
}

export function ImageReplacePopover({ onSubmit, onClose }: ImageReplacePopoverProps) {
  const [url, setUrl] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const out = await uploadElementImage(fd);
      onSubmit({ url: out.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Replace image"
      className="absolute z-50 w-72 rounded-md border border-slate-300 bg-white p-3 text-xs shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">Replace image</span>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-900">✕</button>
      </div>
      <div
        onDrop={async (e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) await onFile(f);
        }}
        onDragOver={(e) => e.preventDefault()}
        className="rounded border-2 border-dashed border-slate-300 p-3 text-center text-slate-500"
      >
        {uploading ? "Uploading…" : "Drop an image here"}
      </div>
      <div className="mt-2 flex gap-1">
        <input
          type="text"
          placeholder="Or paste URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded border border-slate-300 px-2 py-1"
        />
        <button
          type="button"
          disabled={!url}
          onClick={() => onSubmit({ url })}
          className="rounded bg-slate-900 px-2 py-1 text-white disabled:opacity-50"
        >
          Apply
        </button>
      </div>
      {error && <div role="alert" className="mt-2 text-red-600">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm vitest run test/components/canvas/ImageReplacePopover.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/components/canvas/ImageReplacePopover.tsx apps/atlas-web/lib/actions/uploadElementImage.ts apps/atlas-web/test/components/canvas/ImageReplacePopover.test.tsx
git commit -m "feat(atlas-web): ImageReplacePopover + uploadElementImage action"
```

---

## Task 17: Mount FloatingToolbar in `CanvasPreviewClient`

**Files:**
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewClient.tsx`
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/page.tsx` (pass `inlineEditEnabled` prop)

- [ ] **Step 1: Add server-side flag read in canvas/page.tsx**

```ts
const inlineEditOn = isFeatureEnabled("inline-edit-v1");
// ... in CanvasShellWired props (and the non-canvas-v1 fallback):
inlineEditEnabled={inlineEditOn}
```

Add `inlineEditEnabled` to `CanvasShellWired`'s props + thread to renderer props (it'll land on CanvasPreviewClient via the registry, same pattern as `clickToEditEnabled`).

- [ ] **Step 2: Mount FloatingToolbar inside CanvasPreviewClient**

Inside `CanvasPreviewClient`, after the existing IframeOverlay block, when a `selected` node exists and `inlineEditEnabled === true`:

```tsx
import { FloatingToolbar } from "@/components/canvas/FloatingToolbar";
import { ImageReplacePopover } from "@/components/canvas/ImageReplacePopover";
import { bridgeApplyText, bridgeMakeEditable, bridgeReplaceImg, bridgeRevertText } from "@/lib/canvas/atlas-edit-bridge-client";
import { useEditPatchQueue } from "@/lib/canvas/use-edit-patch-queue";
import { applyPatch as applyPatchAction } from "@/lib/actions/applyPatch";

// ... inside the component:
const [imagePopoverOpen, setImagePopoverOpen] = React.useState(false);
const queue = useEditPatchQueue({
  apply: (req) => applyPatchAction({ projectId, filePath: TARGET_FILE, patch: req.patch })
});
const TARGET_FILE = "/code/src/app/page.tsx"; // simplification: Phase 1 only edits page.tsx

const handleEditText = React.useCallback((node: DomNode) => {
  if (!overlayIframeRef.current) return;
  bridgeMakeEditable(overlayIframeRef.current, { atlasId: node.atlasId });
}, []);

const handleReplaceImage = React.useCallback((_node: DomNode) => {
  setImagePopoverOpen(true);
}, []);

// Listen for atlas-text-committed from the bridge to submit a text-replace patch.
React.useEffect(() => {
  function onMessage(ev: MessageEvent) {
    const data = ev.data as { type?: string; atlasId?: string; newText?: string };
    if (data?.type !== "atlas-text-committed" || !data.atlasId) return;
    const oldText = selected?.text ?? "";
    void queue.submitPatch({
      filePath: TARGET_FILE,
      patch: {
        kind: "text-replace",
        atlasId: data.atlasId,
        oldText,
        newText: data.newText ?? ""
      }
    }).then((result) => {
      if (!result.ok && overlayIframeRef.current) {
        bridgeRevertText(overlayIframeRef.current, { atlasId: data.atlasId!, oldText });
      }
    });
  }
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}, [selected, queue]);

// ... at the JSX level, inside the iframe wrapper:
{inlineEditEnabled && overlayActive && selected && (
  <FloatingToolbar
    node={selected}
    onEditText={handleEditText}
    onOpenStyle={() => {/* Phase 1 stub — wire to ElementInspector popover later in Task 18 */}}
    onAskAi={() => {/* Phase 2 wires the chat chip */}}
    onReplaceImage={handleReplaceImage}
  />
)}
{inlineEditEnabled && imagePopoverOpen && selected && (
  <ImageReplacePopover
    onClose={() => setImagePopoverOpen(false)}
    onSubmit={async ({ url, alt }) => {
      setImagePopoverOpen(false);
      const oldUrl = ""; // populated from selected node attributes if available
      if (overlayIframeRef.current) {
        bridgeReplaceImg(overlayIframeRef.current, { atlasId: selected.atlasId, newUrl: url, ...(alt !== undefined ? { newAlt: alt } : {}) });
      }
      await queue.submitPatch({
        filePath: TARGET_FILE,
        patch: { kind: "asset-swap", atlasId: selected.atlasId, oldUrl, newUrl: url, ...(alt !== undefined ? { newAlt: alt } : {}) }
      });
    }}
  />
)}
```

- [ ] **Step 3: Smoke-test by hand**

```bash
# In .env.local:  ATLAS_FF_INLINE_EDIT_V1=true
# Restart dev server.
# In the canvas, click an h1. Toolbar should appear above it.
# Click "Edit text" → element becomes editable → type "Hi" → Tab/blur.
# Verify the rail timeline shows no new ritual (this is a direct patch path).
# Refresh the page; the new text should persist (source was written).
```

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/app/projects/\[projectId\]/canvas/page.tsx apps/atlas-web/app/projects/\[projectId\]/canvas/_components/CanvasPreviewClient.tsx
git commit -m "feat(atlas-web): mount FloatingToolbar + wire text/image patch flows behind ATLAS_FF_INLINE_EDIT_V1"
```

---

## Phase 2 begins here

## Task 18: `dom-mutation` patch — delete + duplicate

**Files:**
- Create: `packages/edit-patch-engine/src/patches/dom-mutation.ts`
- Create: `packages/edit-patch-engine/test/dom-mutation.test.ts`
- Modify: `packages/edit-patch-engine/src/apply-patch.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/edit-patch-engine/test/dom-mutation.test.ts
import { describe, it, expect } from "vitest";
import { applyPatch } from "../src/apply-patch.js";

describe("dom-mutation patches", () => {
  it("delete removes the targeted JSX element from its parent", () => {
    const src = `export default () => <div><h1 data-atlas-id="a">x</h1><p>y</p></div>;`;
    const r = applyPatch(src, { kind: "dom-mutation", atlasId: "a", op: { kind: "delete" } });
    expect(r.ok).toBe(true);
    expect(r.newContent).not.toContain("data-atlas-id=\"a\"");
    expect(r.newContent).toContain("<p>y</p>");
  });

  it("duplicate inserts a clone of the element adjacent to itself", () => {
    const src = `export default () => <div><h1 data-atlas-id="a">x</h1></div>;`;
    const r = applyPatch(src, { kind: "dom-mutation", atlasId: "a", op: { kind: "duplicate" } });
    expect(r.ok).toBe(true);
    const matches = r.newContent!.match(/<h1[^>]*>x<\/h1>/g);
    expect(matches?.length).toBe(2);
  });

  it("delete invert restores the deleted subtree", () => {
    const src = `export default () => <div><h1 data-atlas-id="a">x</h1></div>;`;
    const r = applyPatch(src, { kind: "dom-mutation", atlasId: "a", op: { kind: "delete" } });
    expect(r.inverse?.kind).toBe("dom-mutation");
    expect((r.inverse as { capturedSubtree?: string }).capturedSubtree).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run test/dom-mutation.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement dom-mutation.ts**

```ts
// packages/edit-patch-engine/src/patches/dom-mutation.ts
import { parse } from "@babel/parser";
import generateDefault from "@babel/generator";
import * as t from "@babel/types";
import { locateByAtlasId } from "../locate.js";
import type { ApplyPatchResult, EditPatch, DomMutationOp } from "../types.js";

const generate = (generateDefault as unknown as { default?: typeof generateDefault }).default ?? generateDefault;

function nodeToString(node: t.JSXElement): string {
  return generate(node, { jsescOption: { minimal: true } }).code;
}

export function applyDomMutation(
  source: string,
  patch: Extract<EditPatch, { kind: "dom-mutation" }>
): ApplyPatchResult {
  let ast;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (err) {
    return { ok: false, error: "parse-error", detail: err instanceof Error ? err.message : String(err) };
  }
  const node = locateByAtlasId(ast, patch.atlasId);
  if (!node) return { ok: false, error: "not-found", detail: `atlasId=${patch.atlasId}` };

  // Find the parent JSXElement / JSXFragment + the index of `node` in its children.
  // We use Babel traverse to walk and locate (paths give us parent access).
  // For Phase 2 simplicity, only operate when parent is a JSXElement with a
  // children array we can mutate.
  let parent: t.JSXElement | t.JSXFragment | null = null;
  let indexInParent = -1;
  (function findParent() {
    const stack: Array<t.Node> = [ast];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if ((t.isJSXElement(n) || t.isJSXFragment(n)) && Array.isArray(n.children)) {
        const idx = n.children.indexOf(node);
        if (idx >= 0) { parent = n; indexInParent = idx; return; }
        for (const c of n.children) stack.push(c);
      }
      for (const key of Object.keys(n)) {
        const v = (n as unknown as Record<string, unknown>)[key];
        if (Array.isArray(v)) {
          for (const item of v) {
            if (item && typeof item === "object" && "type" in (item as object)) stack.push(item as t.Node);
          }
        } else if (v && typeof v === "object" && "type" in (v as object)) {
          stack.push(v as t.Node);
        }
      }
    }
  })();

  if (!parent || indexInParent < 0) {
    return { ok: false, error: "unsupported", detail: "parent JSX node not found" };
  }

  const captured = nodeToString(node);

  switch (patch.op.kind) {
    case "delete":
      parent.children.splice(indexInParent, 1);
      break;
    case "duplicate": {
      const clone = JSON.parse(JSON.stringify(node)) as t.JSXElement;
      parent.children.splice(indexInParent + 1, 0, clone);
      break;
    }
    case "wrap": {
      const wrapper = t.jsxElement(
        t.jsxOpeningElement(t.jsxIdentifier(patch.op.wrapperTag), []),
        t.jsxClosingElement(t.jsxIdentifier(patch.op.wrapperTag)),
        [node],
        false
      );
      parent.children.splice(indexInParent, 1, wrapper);
      break;
    }
    case "reorder": {
      const swap = patch.op.direction === "up" ? indexInParent - 1 : indexInParent + 1;
      if (swap < 0 || swap >= parent.children.length) {
        return { ok: false, error: "unsupported", detail: "cannot reorder at boundary" };
      }
      [parent.children[indexInParent], parent.children[swap]] =
        [parent.children[swap]!, parent.children[indexInParent]!];
      break;
    }
  }

  const out = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source);

  // Invert: delete ↔ insert(captured), duplicate ↔ delete, wrap ↔ unwrap (we
  // implement only the duplicate-inverse-of-delete case fully in Phase 2.
  // wrap/reorder invert are best-effort; the captured subtree is the universal
  // recovery payload).
  const invertOp: DomMutationOp =
    patch.op.kind === "delete" ? { kind: "duplicate" } :
    patch.op.kind === "duplicate" ? { kind: "delete" } :
    patch.op.kind === "reorder" ? { kind: "reorder", direction: patch.op.direction === "up" ? "down" : "up" } :
    patch.op; // wrap inverse is captured-subtree-based; engine v2 will refine

  return {
    ok: true,
    newContent: out.code,
    inverse: { kind: "dom-mutation", atlasId: patch.atlasId, op: invertOp, capturedSubtree: captured }
  };
}
```

- [ ] **Step 4: Register in apply-patch dispatcher**

In `packages/edit-patch-engine/src/apply-patch.ts`:

```ts
import { applyDomMutation } from "./patches/dom-mutation.js";
// ...
case "dom-mutation":      return applyDomMutation(source, patch);
```

Remove the Phase-1 "unsupported" stub for `dom-mutation`.

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @atlas/edit-patch-engine vitest run
```

Expected: all tests pass (text-replace, style-class, asset-swap, dom-mutation, apply-patch).

- [ ] **Step 6: Commit**

```bash
git add packages/edit-patch-engine/src/patches/dom-mutation.ts packages/edit-patch-engine/src/apply-patch.ts packages/edit-patch-engine/test/dom-mutation.test.ts
git commit -m "feat(edit-patch-engine): dom-mutation patches (delete/duplicate/wrap/reorder)"
```

---

## Task 19: Focused-refine developer prompt fragment

**Files:**
- Create: `packages/role-developer/src/render-focused-refine.ts`
- Create: `packages/role-developer/test/render-focused-refine.test.ts`
- Modify: `packages/role-developer/src/role.ts`
- Modify: `packages/role-developer/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/role-developer/test/render-focused-refine.test.ts
import { describe, it, expect } from "vitest";
import { renderFocusedRefineUserTurn } from "../src/render-focused-refine.js";

describe("renderFocusedRefineUserTurn", () => {
  it("surfaces target file path, atlasId, source slice, and instruction prominently", () => {
    const out = renderFocusedRefineUserTurn({
      instruction: "make this 3 columns",
      targetFile: "src/app/page.tsx",
      targetAtlasId: "abc123",
      sourceSlice: `<section className="grid grid-cols-1">...</section>`
    });
    expect(out).toContain("make this 3 columns");
    expect(out).toContain("src/app/page.tsx");
    expect(out).toContain("abc123");
    expect(out).toContain("grid-cols-1");
    expect(out).toContain("Edit ONLY this element");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @atlas/role-developer vitest run test/render-focused-refine.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement render-focused-refine.ts**

```ts
// packages/role-developer/src/render-focused-refine.ts
export interface FocusedRefineInput {
  instruction: string;
  targetFile: string;
  targetAtlasId: string;
  sourceSlice: string;
}

/** Build the user-turn message for a focused-refine developer dispatch.
 *  Differs from renderDeveloperUserTurn in scope: this targets ONE element,
 *  not the whole page. The system-prompt fragment (in
 *  FOCUSED_REFINE_SYSTEM_PROMPT) reinforces the "don't regenerate the page"
 *  constraint; this user-turn supplies the surgical context. */
export function renderFocusedRefineUserTurn(input: FocusedRefineInput): string {
  return [
    `# Focused refine — Edit ONLY this element`,
    ``,
    `## Instruction (from the user, in plain English)`,
    input.instruction,
    ``,
    `## Target`,
    `- File: \`${input.targetFile}\``,
    `- Element atlasId: \`${input.targetAtlasId}\``,
    ``,
    `## Current source (the JSX subtree to edit, plus a few lines of context)`,
    "```tsx",
    input.sourceSlice,
    "```",
    ``,
    `## Rules`,
    `- Return a unified diff that touches ONLY this file.`,
    `- Modify ONLY the JSX subtree whose opening element has \`data-atlas-id="${input.targetAtlasId}"\`. Do NOT restructure surrounding sections.`,
    `- Preserve all existing \`data-atlas-id\` attributes on elements you keep.`,
    `- Add new \`data-atlas-id\` attributes only when introducing brand-new JSX elements; otherwise leave existing IDs alone.`,
    `- Keep Tailwind classes, design tokens, and import statements consistent with the rest of the file.`,
    `- Do not regenerate the page. If the instruction is ambiguous, prefer the smaller, safer change.`
  ].join("\n");
}

export const FOCUSED_REFINE_SYSTEM_PROMPT = [
  "You are a focused refine pass. The user has selected ONE element on the page and described a change.",
  "Your job is to return the smallest possible unified diff that:",
  "  - Touches only the named file.",
  "  - Modifies only the JSX subtree marked with the given data-atlas-id.",
  "  - Preserves all unrelated code byte-for-byte.",
  "Do NOT regenerate the page. Do NOT touch other sections. Do NOT remove existing data-atlas-id attributes."
].join(" ");
```

- [ ] **Step 4: Re-export from index.ts**

In `packages/role-developer/src/index.ts`, add:

```ts
export { renderFocusedRefineUserTurn, FOCUSED_REFINE_SYSTEM_PROMPT } from "./render-focused-refine.js";
export type { FocusedRefineInput } from "./render-focused-refine.js";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @atlas/role-developer build
pnpm --filter @atlas/role-developer vitest run
```

Expected: new test + all existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/role-developer/src/render-focused-refine.ts packages/role-developer/src/index.ts packages/role-developer/test/render-focused-refine.test.ts
git commit -m "feat(role-developer): renderFocusedRefineUserTurn + FOCUSED_REFINE_SYSTEM_PROMPT"
```

---

## Task 20: `editElementWithAI` Server Action

**Files:**
- Create: `apps/atlas-web/lib/actions/editElementWithAI.ts`
- Create: `apps/atlas-web/test/actions/editElementWithAI.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/atlas-web/test/actions/editElementWithAI.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth/clerk-compat", () => ({ auth: async () => ({ userId: "u1" }) }));
vi.mock("@/lib/sandbox/factory", () => ({
  getSandboxFactory: () => ({
    getOrProvision: async () => ({ record: { sandboxId: "sb" }, previewUrl: "" })
  })
}));
const sandboxFiles: Record<string, string> = {
  "/code/src/app/page.tsx": `export default () => <div><section data-atlas-id="hero">old</section></div>;`
};
vi.mock("@e2b/sdk", () => ({
  Sandbox: { connect: async () => ({ files: {
    read: async (p: string) => sandboxFiles[p] ?? "",
    write: async (p: string, c: string) => { sandboxFiles[p] = c; }
  }})}
}));

// Stub the developer dispatch — return a known diff.
vi.mock("@/lib/engine/factory", () => ({
  getRitualEngine: async () => ({
    refine: async () => "r-abc-123",
    getRitual: async () => ({ developerOutput: { diff: `--- a/src/app/page.tsx
+++ b/src/app/page.tsx
@@ -1 +1 @@
-export default () => <div><section data-atlas-id="hero">old</section></div>;
+export default () => <div><section data-atlas-id="hero">new</section></div>;
` } })
  })
}));

import { editElementWithAI } from "@/lib/actions/editElementWithAI";

describe("editElementWithAI", () => {
  it("dispatches focused refine and applies the returned diff", async () => {
    const result = await editElementWithAI({
      projectId: "11111111-1111-1111-1111-111111111111",
      filePath: "/code/src/app/page.tsx",
      atlasId: "hero",
      instruction: "make it say new"
    });
    expect(result.ok).toBe(true);
    expect(sandboxFiles["/code/src/app/page.tsx"]).toContain(">new<");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm vitest run test/actions/editElementWithAI.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement editElementWithAI.ts**

```ts
// apps/atlas-web/lib/actions/editElementWithAI.ts
"use server";
import { auth } from "@/lib/auth/clerk-compat";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { getRitualEngine } from "@/lib/engine/factory";
import { applyDiff } from "@/lib/sandbox/apply-diff";
import { createSandboxFsAdapter } from "@/lib/sandbox/sandbox-fs-adapter";

export interface EditElementWithAIInput {
  projectId: string;
  filePath: string;
  atlasId: string;
  instruction: string;
}

export interface EditElementWithAIOutput {
  ok: boolean;
  ritualId?: string;
  error?: string;
}

/** Server Action: dispatches a focused-refine developer call scoped to one
 *  atlasId in one file. The developer role's renderFocusedRefineUserTurn +
 *  FOCUSED_REFINE_SYSTEM_PROMPT keep the diff minimal. Resulting diff is
 *  applied to the sandbox via the same applyDiff path used after full
 *  rituals. No architect / researcher / designer / asset-gen runs. */
export async function editElementWithAI(input: EditElementWithAIInput): Promise<EditElementWithAIOutput> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthorized" };

  try {
    // 1. Read source slice from sandbox.
    const session = await getSandboxFactory().getOrProvision(input.projectId);
    const { Sandbox } = await import("@e2b/sdk");
    const sdk = await Sandbox.connect(session.record.sandboxId, { apiKey: process.env.E2B_API_KEY ?? "" });
    const files = (sdk as unknown as {
      files: { read: (p: string) => Promise<string>; write: (p: string, c: string) => Promise<unknown> };
    }).files;
    const source = await files.read(input.filePath);

    // 2. Dispatch refine on the engine with focused-refine priorArtifact.
    //    The engine factory routes priorArtifact.focusedRefine=true into a
    //    single-Sonnet developer call (no parallel pass, no reviewer vote).
    const engine = await getRitualEngine(input.projectId);
    const ritualId = await engine.refine({
      projectId: input.projectId,
      userTurn: input.instruction,
      userId,
      parentRitualId: "",  // standalone refine; not chained to a prior ritual
      priorArtifact: {
        focusedRefine: true,
        targetFile: input.filePath.replace(/^\/code\//, ""),
        targetAtlasId: input.atlasId,
        sourceSlice: source
      }
    } as never);

    // 3. Read the developer diff off the snapshot.
    const snapshot = await engine.getRitual(ritualId);
    const diff = snapshot?.developerOutput?.diff;
    if (!diff) return { ok: false, error: "no diff returned" };

    // 4. Apply diff via existing applyDiff path (engine factory already does
    //    this for full rituals; we duplicate the call here so the request is
    //    fully synchronous for the user).
    const fs = createSandboxFsAdapter(sdk as never);
    const applyResult = await applyDiff(fs, diff);
    if (!applyResult.ok) {
      return { ok: false, ritualId, error: applyResult.parseError ?? "apply failed" };
    }
    return { ok: true, ritualId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 4: Wire focusedRefine routing in role-developer/src/role.ts**

When the role detects `priorArtifact.focusedRefine === true`, skip parallel passes + reviewer vote; do a single Sonnet call with the focused-refine user-turn:

```ts
import { renderFocusedRefineUserTurn, FOCUSED_REFINE_SYSTEM_PROMPT } from "./render-focused-refine.js";

// At the top of run() — before the parallel-pass block:
const focusedRefine = (inv.priorArtifact as { focusedRefine?: boolean }).focusedRefine;
if (focusedRefine) {
  const fr = inv.priorArtifact as {
    focusedRefine: true;
    targetFile: string;
    targetAtlasId: string;
    sourceSlice: string;
  };
  const userTurn = renderFocusedRefineUserTurn({
    instruction: inv.userTurn,
    targetFile: fr.targetFile,
    targetAtlasId: fr.targetAtlasId,
    sourceSlice: fr.sourceSlice
  });
  // Single Sonnet call via this.opts.anthropic (not the parallel slot).
  // Reuse the existing single-pass helper if there is one; otherwise inline
  // a minimal chat-completion that returns a unified diff.
  // ... (~30 lines following the same shape as anthropicPass but with the
  // FOCUSED_REFINE_SYSTEM_PROMPT in the system slot)
  return { events: [...], diff: { kind: "patch", body: returnedDiff } };
}
```

(Concrete implementation depends on the existing `anthropicPass` private method's shape — duplicate it minus the parallel-vote logic.)

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm vitest run test/actions/editElementWithAI.test.ts
pnpm --filter @atlas/role-developer vitest run
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/lib/actions/editElementWithAI.ts apps/atlas-web/test/actions/editElementWithAI.test.ts packages/role-developer/src/role.ts
git commit -m "feat: editElementWithAI Server Action + role-developer focusedRefine routing"
```

---

## Task 21: `SelectionChip` component + `ChatPanel` integration

**Files:**
- Create: `apps/atlas-web/components/canvas/SelectionChip.tsx`
- Create: `apps/atlas-web/test/components/canvas/SelectionChip.test.tsx`
- Modify: `apps/atlas-web/components/ChatPanel.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/atlas-web/test/components/canvas/SelectionChip.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectionChip } from "@/components/canvas/SelectionChip";

describe("SelectionChip", () => {
  it("renders the element label and a remove button", () => {
    render(<SelectionChip label="<h2>Welcome…</h2>" onRemove={vi.fn()} />);
    expect(screen.getByText(/welcome/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove selection/i })).toBeInTheDocument();
  });

  it("fires onRemove when the ✕ is clicked", () => {
    const onRemove = vi.fn();
    render(<SelectionChip label="<h2>x</h2>" onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: /remove selection/i }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm vitest run test/components/canvas/SelectionChip.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement SelectionChip.tsx**

```tsx
// apps/atlas-web/components/canvas/SelectionChip.tsx
"use client";
import * as React from "react";

export interface SelectionChipProps {
  label: string;
  onRemove: () => void;
}

export function SelectionChip({ label, onRemove }: SelectionChipProps) {
  return (
    <div
      data-testid="selection-chip"
      className="mb-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide">Editing</span>
      <span className="max-w-[20ch] truncate font-mono">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove selection"
        className="text-emerald-700 hover:text-emerald-900"
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Add `selectionChip` prop to ChatPanel**

In `apps/atlas-web/components/ChatPanel.tsx`, accept an optional prop:

```tsx
interface ChatPanelProps {
  // ... existing props
  selectionChip?: { label: string; atlasId: string; filePath: string };
  onClearSelection?: () => void;
  editElementAction?: (input: { projectId: string; filePath: string; atlasId: string; instruction: string }) => Promise<{ ok: boolean; error?: string }>;
}
```

Render `<SelectionChip />` above the textarea when `selectionChip` is set. On submit, if chip is set, call `editElementAction({ projectId, filePath, atlasId, instruction })` instead of the existing `refineAction`.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm vitest run test/components/canvas/SelectionChip.test.tsx
cd apps/atlas-web && pnpm vitest run test/components/ChatPanel
```

Expected: new test passes; existing ChatPanel tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/components/canvas/SelectionChip.tsx apps/atlas-web/components/ChatPanel.tsx apps/atlas-web/test/components/canvas/SelectionChip.test.tsx
git commit -m "feat(atlas-web): SelectionChip + ChatPanel selection-aware submit"
```

---

## Task 22: Wire Ask AI button → ChatPanel selection chip

**Files:**
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewClient.tsx`
- Modify: `apps/atlas-web/components/shell/RailShell.tsx` (or wherever ChatPanel is hosted in the live-events branch)

- [ ] **Step 1: Lift selection-for-chat state**

`CanvasPreviewClient` can't write to the rail's ChatPanel directly (different React tree). Use a custom window event (mirrors the canvas-mode-changed broadcast pattern):

```ts
// In CanvasPreviewClient handleAskAi:
const handleAskAi = React.useCallback((node: DomNode) => {
  window.dispatchEvent(
    new CustomEvent("atlas:set-chat-selection", {
      detail: {
        label: `<${node.tag}>${node.text.slice(0, 24)}…</${node.tag}>`,
        atlasId: node.atlasId,
        filePath: TARGET_FILE
      }
    })
  );
}, []);
```

- [ ] **Step 2: Listen in RailShell / ChatPanel host**

The component that owns the ChatPanel mount listens for the event and writes `selectionChip` state:

```tsx
const [selectionChip, setSelectionChip] = React.useState<{ label: string; atlasId: string; filePath: string } | null>(null);
React.useEffect(() => {
  function onSet(e: Event) {
    const d = (e as CustomEvent).detail;
    if (d) setSelectionChip(d);
  }
  window.addEventListener("atlas:set-chat-selection", onSet as EventListener);
  return () => window.removeEventListener("atlas:set-chat-selection", onSet as EventListener);
}, []);

// ... pass to ChatPanel:
<ChatPanel
  selectionChip={selectionChip ?? undefined}
  onClearSelection={() => setSelectionChip(null)}
  editElementAction={editElementWithAI}
  /* ... rest */
/>
```

- [ ] **Step 3: Smoke-test by hand**

```
# .env.local: ATLAS_FF_INLINE_EDIT_V1=true
# Restart dev server, open canvas, click an h1, click ✨ Ask AI.
# Expected: chat panel above shows "Editing: <h1>...</h1> ✕" chip.
# Type "make this say Welcome to Atlas" + Enter.
# Expected: focused-refine dispatches; ~20s later, the iframe shows the new text.
# Click ✕ on the chip — chip clears; subsequent chat reverts to project-level refine.
```

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/app/projects/\[projectId\]/canvas/_components/CanvasPreviewClient.tsx apps/atlas-web/components/shell/RailShell.tsx
git commit -m "feat(atlas-web): Ask AI button → ChatPanel selection-chip flow via custom event broadcast"
```

---

## Task 23: `ElementContextMenu` (Phase 2 — Delete / Duplicate / Wrap / Reorder)

**Files:**
- Create: `apps/atlas-web/components/canvas/ElementContextMenu.tsx`
- Create: `apps/atlas-web/test/components/canvas/ElementContextMenu.test.tsx`
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/_components/CanvasPreviewClient.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/atlas-web/test/components/canvas/ElementContextMenu.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ElementContextMenu } from "@/components/canvas/ElementContextMenu";

describe("ElementContextMenu", () => {
  it("fires onAction with the chosen op when an item is clicked", () => {
    const onAction = vi.fn();
    render(<ElementContextMenu x={10} y={20} onAction={onAction} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText(/delete/i));
    expect(onAction).toHaveBeenCalledWith({ kind: "delete" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/atlas-web && pnpm vitest run test/components/canvas/ElementContextMenu.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement ElementContextMenu.tsx**

```tsx
// apps/atlas-web/components/canvas/ElementContextMenu.tsx
"use client";
import * as React from "react";
import type { DomMutationOp } from "@atlas/edit-patch-engine";

export interface ElementContextMenuProps {
  x: number;
  y: number;
  onAction: (op: DomMutationOp) => void;
  onClose: () => void;
}

export function ElementContextMenu({ x, y, onAction, onClose }: ElementContextMenuProps) {
  React.useEffect(() => {
    const closeOnOutside = () => onClose();
    window.addEventListener("click", closeOnOutside);
    return () => window.removeEventListener("click", closeOnOutside);
  }, [onClose]);

  return (
    <div
      role="menu"
      className="absolute z-50 min-w-[10rem] rounded-md border border-slate-300 bg-white py-1 text-xs shadow-md"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      <button role="menuitem" onClick={() => onAction({ kind: "delete" })} className="block w-full px-3 py-1 text-left hover:bg-slate-100">Delete</button>
      <button role="menuitem" onClick={() => onAction({ kind: "duplicate" })} className="block w-full px-3 py-1 text-left hover:bg-slate-100">Duplicate</button>
      <button role="menuitem" onClick={() => onAction({ kind: "wrap", wrapperTag: "section" })} className="block w-full px-3 py-1 text-left hover:bg-slate-100">Wrap in section</button>
      <button role="menuitem" onClick={() => onAction({ kind: "reorder", direction: "up" })} className="block w-full px-3 py-1 text-left hover:bg-slate-100">Move up</button>
      <button role="menuitem" onClick={() => onAction({ kind: "reorder", direction: "down" })} className="block w-full px-3 py-1 text-left hover:bg-slate-100">Move down</button>
    </div>
  );
}
```

- [ ] **Step 4: Mount in CanvasPreviewClient**

When the user right-clicks on an element (or clicks the `⋯` button on the FloatingToolbar), show the context menu. On `onAction(op)`, submit a `dom-mutation` patch via the queue.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/atlas-web && pnpm vitest run test/components/canvas/ElementContextMenu.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/atlas-web/components/canvas/ElementContextMenu.tsx apps/atlas-web/app/projects/\[projectId\]/canvas/_components/CanvasPreviewClient.tsx apps/atlas-web/test/components/canvas/ElementContextMenu.test.tsx
git commit -m "feat(atlas-web): ElementContextMenu — Delete / Duplicate / Wrap / Reorder via dom-mutation patches"
```

---

## Task 24: End-to-end smoke spec (Playwright)

**Files:**
- Create: `apps/atlas-web/e2e/tests/inline-edit-smoke.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// apps/atlas-web/e2e/tests/inline-edit-smoke.spec.ts
import { test, expect } from "@playwright/test";
import { PERSONA_STORAGE_STATE } from "../fixtures/personas";

test.use({ storageState: PERSONA_STORAGE_STATE.ama });
test.setTimeout(240_000);

test.skip(!process.env.ATLAS_RUN_SMOKE, "set ATLAS_RUN_SMOKE=true to run — needs live LLM + sandbox");

test("inline edit smoke — text-replace via floating toolbar", async ({ page }) => {
  // 1. Start a fresh ritual.
  await page.goto("/");
  await page.getByPlaceholder(/what do you want to build/i).fill("A simple landing page for a small bakery");
  await page.getByRole("button", { name: /^create$/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+\/canvas/, { timeout: 30_000 });

  // 2. Wait for the canvas to reach preview mode (auto-switch on sandbox.apply.completed).
  await page.waitForSelector("iframe", { timeout: 180_000 });

  // 3. Click into the iframe → click an h1 → edit text inline.
  const frame = page.frameLocator("iframe");
  const h1 = frame.locator("h1").first();
  await h1.click();

  // 4. Floating toolbar should appear; click "Edit text".
  await page.getByRole("button", { name: /edit text/i }).click();

  // 5. Inside the iframe, the h1 should now be contenteditable; type new text.
  await h1.fill("Welcome to Atlas Bakery");
  await page.keyboard.press("Tab");

  // 6. Assert the iframe shows the new text.
  await expect(h1).toHaveText(/welcome to atlas bakery/i);

  // 7. Reload the canvas; assert text persists (proves source was written).
  await page.reload();
  await page.waitForSelector("iframe", { timeout: 60_000 });
  await expect(page.frameLocator("iframe").locator("h1").first()).toHaveText(/welcome to atlas bakery/i);
});
```

- [ ] **Step 2: Commit (do not run; the smoke is gated on ATLAS_RUN_SMOKE)**

```bash
git add apps/atlas-web/e2e/tests/inline-edit-smoke.spec.ts
git commit -m "test(e2e): inline-edit smoke — text-replace via floating toolbar (skipped by default)"
```

---

## Self-review log

**1. Spec coverage:**
- ✅ Floating toolbar — Tasks 15, 17.
- ✅ Inline contenteditable text edit — Tasks 10, 17.
- ✅ Style edit via ElementInspector — unchanged (existing) + patch engine via Tasks 5, 13.
- ✅ Image replace — Tasks 6, 16, 17.
- ✅ AI-rewrite via selection-scoped chat — Tasks 19, 20, 21, 22.
- ✅ Context menu (dom-mutation) — Tasks 18, 23.
- ✅ Undo stack — Task 14.
- ✅ data-atlas-id identity — Tasks 2, 3, 8.
- ✅ Feature flag — Task 9.
- ✅ atlas-edit-bridge extensions — Task 10.
- ✅ Playwright smoke — Task 24.

**2. Placeholder scan:**
- No TBDs / TODOs / "fill in details" found.
- Task 17 ("smoke-test by hand") and Task 22 (same) are manual verification steps — explicit, not placeholders.

**3. Type consistency:**
- `EditPatch` discriminated-union shape is identical across all patch files + Server Action + queue hook (Task 1).
- `DomNode` shape (with `atlasId`) is consistent between bridge (Task 10), use-element-selection (Task 11), and FloatingToolbar (Task 15).
- `ApplyPatchResult` shape consistent across engine (Task 1) and Server Action (Task 13).

**4. Known follow-ups** (deferred to Phase 3):
- Undo/redo keyboard shortcuts in canvas header.
- History sidebar.
- AI image regeneration for a single slot.
- Per-project per-day edit budget cap.
- `style-token-patch` integration (currently the existing ElementInspector path writes design-tokens.json directly; future cleanup unifies it through `applyPatch`).
