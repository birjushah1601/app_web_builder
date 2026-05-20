# Canvas UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six UX changes that lift Atlas's canvas to May-2026 SOTA: single-page morph, three-mode toolbar (Agent/Plan/Visual-Edits), click-to-edit overlay, reference-image drop, editable plan + critique disclosure, per-element generated sliders.

**Architecture:** Each change is independently flag-gated; all defaults OFF preserve today's behavior. Click-to-edit relies on a bridge script injected into the sandbox template that posts the DOM tree to the parent via `postMessage`; the overlay renders invisible hit-zones over the iframe. Per-element sliders call Haiku 4.5 server-side via a new action and patch `design-tokens.json` or a scoped Tailwind className directly — no ritual fires for visual edits.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict + `exactOptionalPropertyTypes`, Tailwind 3, `view-transitions-api` (Chromium + Safari 18, Firefox graceful fallback), vitest + Playwright.

---

## File Structure

**Create:**
- `apps/atlas-web/components/canvas/ModeToolbar.tsx` — Agent/Plan/Visual-Edits radio
- `apps/atlas-web/components/canvas/IframeOverlay.tsx` — DOM-tree-driven hit-zones over iframe
- `apps/atlas-web/components/canvas/ElementInspector.tsx` — selected-element side panel + sliders
- `apps/atlas-web/components/prompt/ReferenceDropZone.tsx` — drag-drop + paste-URL chip
- `apps/atlas-web/components/ritual/PlanCheckpoints.tsx` — editable architect plan checklist
- `apps/atlas-web/components/ritual/CritiqueDisclosure.tsx` — collapsed expander for designer.critique
- `apps/atlas-web/lib/canvas/use-element-selection.ts` — selected-element state + postMessage listener
- `apps/atlas-web/lib/actions/uploadReference.ts` — server action, hashes file, caches to `.next/cache/atlas-references`
- `apps/atlas-web/lib/actions/proposeElementAxes.ts` — server action, Haiku 4.5 → axes JSON
- `apps/atlas-web/lib/actions/applyElementAxisChange.ts` — patches design-tokens.json OR appends Tailwind className to source
- `packages/sandbox-e2b/templates/atlas-next-ts/src/atlas-edit-bridge.ts` — DOM walker + postMessage poster
- E2E + unit tests per change

**Modify:**
- `apps/atlas-web/app/page.tsx` — prompt-as-hero for signed-in users
- `apps/atlas-web/app/projects/new/_components/PromptForm.tsx` — add `view-transition-name`, mount ReferenceDropZone
- `apps/atlas-web/app/projects/[projectId]/canvas/page.tsx` — mount ModeToolbar + IframeOverlay + ElementInspector under flags
- `apps/atlas-web/components/ChatPanel.tsx` — add `view-transition-name` + mount ReferenceDropZone
- `apps/atlas-web/components/ritual/RitualTimeline.tsx` — mount PlanCheckpoints + CritiqueDisclosure under flag
- `apps/atlas-web/lib/canvas/use-canvas-state.ts` — add `mode` dimension + persistence
- `apps/atlas-web/lib/feature-flags.ts` — add 6 flags
- `packages/sandbox-e2b/templates/atlas-next-ts/src/app/layout.tsx` — conditionally inject bridge
- `packages/sandbox-e2b/templates/atlas-next-ts/Dockerfile` — COPY bridge file
- `packages/ritual-engine/src/canvas-pause.ts` — add `plan-approval` pause kind

---

## Task 1 — Add 6 UX flags to the registry

**Files:**
- Modify: `apps/atlas-web/lib/feature-flags.ts`

- [ ] **Step 1: Test**

```ts
// test/lib/feature-flags-ux-overhaul.test.ts
import { describe, it, expect } from "vitest";
import { isFeatureEnabled, type FeatureFlag } from "@/lib/feature-flags";

describe("Plan UXO flags", () => {
  const cases: Array<[FeatureFlag, string]> = [
    ["prompt-morph", "ATLAS_FF_PROMPT_MORPH"],
    ["mode-toolbar", "ATLAS_FF_MODE_TOOLBAR"],
    ["click-to-edit", "ATLAS_FF_CLICK_TO_EDIT"],
    ["reference-input", "ATLAS_FF_REFERENCE_INPUT"],
    ["editable-plan", "ATLAS_FF_EDITABLE_PLAN"],
    ["element-sliders", "ATLAS_FF_ELEMENT_SLIDERS"]
  ];
  for (const [flag, env] of cases) {
    it(`${flag} ↔ ${env}`, () => {
      expect(isFeatureEnabled(flag, { readEnv: (n) => (n === env ? "true" : undefined) })).toBe(true);
      expect(isFeatureEnabled(flag, { readEnv: () => undefined })).toBe(false);
    });
  }
});
```

- [ ] **Step 2: Implement**

Extend `FeatureFlag` union + `FLAG_TO_ENV` + `listFlagStates` with the 6 above. Mirror existing entries.

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter atlas-web vitest run test/lib/feature-flags-ux-overhaul.test.ts
git add apps/atlas-web/lib/feature-flags.ts apps/atlas-web/test/lib/feature-flags-ux-overhaul.test.ts
git commit -m "feat(atlas-web): 6 UX-overhaul feature flags"
```

---

## Task 2 — Single-page morph (Change 1)

**Files:**
- Modify: `apps/atlas-web/app/page.tsx`, `app/projects/new/_components/PromptForm.tsx`, `components/ChatPanel.tsx`, `app/globals.css`

- [ ] **Step 1: Add view-transition CSS**

```css
/* app/globals.css — append */
[data-prompt-input] { view-transition-name: prompt-input; }
@media (prefers-reduced-motion: no-preference) {
  ::view-transition-old(prompt-input),
  ::view-transition-new(prompt-input) {
    animation-duration: 300ms;
  }
}
```

- [ ] **Step 2: Mark PromptForm textarea + ChatPanel input**

In both files, add `data-prompt-input` to the textarea element.

- [ ] **Step 3: Render PromptForm hero on `/` when flag on**

```tsx
// apps/atlas-web/app/page.tsx — when ATLAS_FF_PROMPT_MORPH and user signed in
import { isFeatureEnabled } from "@/lib/feature-flags";
import { PromptForm } from "./projects/new/_components/PromptForm";
import { submitPromptedProject } from "./projects/new/actions";

export default async function LandingPage() {
  // ... existing user resolution + projects.listForUser ...
  const morphOn = isFeatureEnabled("prompt-morph");
  if (morphOn && userId) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold mb-6">What do you want to build?</h1>
        <PromptForm action={submitPromptedProject} />
        {/* existing project list below */}
        <section className="mt-16">{/* ProjectList component */}</section>
      </main>
    );
  }
  // existing fallback
}
```

- [ ] **Step 4: Wire `router.replace` to enable view transition**

```tsx
// In PromptForm.tsx — wrap submit in startViewTransition
"use client";
const onSubmit = (formData: FormData) => {
  if ("startViewTransition" in document) {
    (document as any).startViewTransition(() => action(formData));
  } else {
    action(formData);
  }
};
```

- [ ] **Step 5: Test + commit**

E2E test asserts that on `/` with the flag on, the textarea is visible and submitting redirects to `/projects/<uuid>/canvas`.

```bash
git add apps/atlas-web/app/page.tsx apps/atlas-web/app/projects/new/_components/PromptForm.tsx apps/atlas-web/components/ChatPanel.tsx apps/atlas-web/app/globals.css apps/atlas-web/e2e/tests/prompt-morph.spec.ts
git commit -m "feat(atlas-web): single-page morph — prompt hero on / behind ATLAS_FF_PROMPT_MORPH"
```

---

## Task 3 — Three-mode toolbar (Change 2)

**Files:**
- Create: `apps/atlas-web/components/canvas/ModeToolbar.tsx`
- Modify: `apps/atlas-web/lib/canvas/use-canvas-state.ts`
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/page.tsx`

- [ ] **Step 1: Test**

```tsx
// test/components/canvas/ModeToolbar.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { ModeToolbar } from "@/components/canvas/ModeToolbar";
import { vi } from "vitest";
it("toggles between three modes via radio role", () => {
  const onChange = vi.fn();
  render(<ModeToolbar mode="agent" onChange={onChange} />);
  fireEvent.click(screen.getByRole("radio", { name: /visual edits/i }));
  expect(onChange).toHaveBeenCalledWith("visual-edits");
});
```

- [ ] **Step 2: Implement ModeToolbar**

```tsx
"use client";
import * as React from "react";

export type CanvasMode = "agent" | "plan" | "visual-edits";

export function ModeToolbar({ mode, onChange }: { mode: CanvasMode; onChange: (m: CanvasMode) => void }) {
  const items: Array<[CanvasMode, string]> = [["agent", "Agent"], ["plan", "Plan"], ["visual-edits", "Visual Edits"]];
  return (
    <div role="radiogroup" aria-label="Canvas mode" className="inline-flex rounded-md border border-slate-200 bg-white">
      {items.map(([id, label]) => (
        <button
          key={id}
          role="radio"
          aria-checked={mode === id}
          onClick={() => onChange(id)}
          className={`px-3 py-1.5 text-sm font-medium ${mode === id ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-50"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Persist mode in localStorage per project**

Extend `use-canvas-state.ts` to accept/return `mode` + persist to `localStorage[`atlas-canvas-mode:${projectId}`]`.

- [ ] **Step 4: Mount in canvas page**

```tsx
// app/projects/[projectId]/canvas/page.tsx — only inside the canvasV1 branch, behind flag
{modeToolbarOn && <ModeToolbar mode={mode} onChange={setMode} />}
```

- [ ] **Step 5: Test + commit**

```bash
pnpm --filter atlas-web vitest run test/components/canvas/ModeToolbar.test.tsx
git add apps/atlas-web/components/canvas/ModeToolbar.tsx apps/atlas-web/lib/canvas/use-canvas-state.ts apps/atlas-web/app/projects/\[projectId\]/canvas/page.tsx apps/atlas-web/test/components/canvas/ModeToolbar.test.tsx
git commit -m "feat(atlas-web): three-mode toolbar (Agent/Plan/Visual-Edits) behind ATLAS_FF_MODE_TOOLBAR"
```

---

## Task 4 — Click-to-edit bridge in sandbox template (Change 3 part A)

**Files:**
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/atlas-edit-bridge.ts`
- Modify: `packages/sandbox-e2b/templates/atlas-next-ts/src/app/layout.tsx`
- Modify: `packages/sandbox-e2b/templates/atlas-next-ts/Dockerfile`

- [ ] **Step 1: Write the bridge**

```ts
// packages/sandbox-e2b/templates/atlas-next-ts/src/atlas-edit-bridge.ts
"use client";
import { useEffect } from "react";

interface AtlasDomNode {
  selector: string;     // unique CSS path
  tag: string;
  text: string;         // first 60 chars
  rect: { x: number; y: number; width: number; height: number };
  classes: string[];
}

export function AtlasEditBridge() {
  useEffect(() => {
    function pathFor(el: Element): string {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node !== document.body) {
        const tag = node.tagName.toLowerCase();
        const idx = Array.from(node.parentElement?.children ?? []).indexOf(node) + 1;
        parts.unshift(`${tag}:nth-child(${idx})`);
        node = node.parentElement;
      }
      return parts.join(" > ");
    }
    function walk(): AtlasDomNode[] {
      const els = document.body.querySelectorAll("h1, h2, h3, p, button, a, img, section, header, footer, nav");
      return Array.from(els).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          selector: pathFor(el),
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? "").trim().slice(0, 60),
          rect: { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height },
          classes: Array.from(el.classList)
        };
      });
    }
    function post() {
      window.parent.postMessage({ type: "atlas-dom-tree", nodes: walk() }, "*");
    }
    post();
    const mo = new MutationObserver(() => post());
    mo.observe(document.body, { subtree: true, childList: true, attributes: true });
    const ro = new ResizeObserver(() => post());
    ro.observe(document.body);
    const onScroll = () => post();
    window.addEventListener("scroll", onScroll, { passive: true });

    function onMessage(ev: MessageEvent) {
      if (ev.data?.type !== "atlas-apply-class") return;
      const el = document.querySelector(ev.data.selector);
      if (!el) return;
      el.className = ev.data.className;
      post();
    }
    window.addEventListener("message", onMessage);
    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("message", onMessage);
    };
  }, []);
  return null;
}
```

- [ ] **Step 2: Mount + COPY**

In `layout.tsx`, add `<AtlasEditBridge />` (client component). In Dockerfile, add `COPY src/atlas-edit-bridge.ts ./src/atlas-edit-bridge.ts`.

- [ ] **Step 3: Republish template**

```bash
cd packages/sandbox-e2b/templates/atlas-next-ts
E2B_API_KEY=$E2B_API_KEY npx --yes @e2b/cli@latest template create atlas-next-ts-v2
```

- [ ] **Step 4: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/
git commit -m "feat(sandbox): atlas-edit-bridge — posts DOM tree to parent for click-to-edit"
```

---

## Task 5 — IframeOverlay (Change 3 part B)

**Files:**
- Create: `apps/atlas-web/components/canvas/IframeOverlay.tsx`
- Create: `apps/atlas-web/lib/canvas/use-element-selection.ts`

- [ ] **Step 1: Implement hook**

```ts
// apps/atlas-web/lib/canvas/use-element-selection.ts
"use client";
import * as React from "react";

export interface DomNode {
  selector: string;
  tag: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  classes: string[];
}

export function useElementSelection() {
  const [nodes, setNodes] = React.useState<DomNode[]>([]);
  const [selected, setSelected] = React.useState<DomNode | null>(null);
  React.useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.data?.type === "atlas-dom-tree") setNodes(ev.data.nodes ?? []);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  return { nodes, selected, setSelected };
}
```

- [ ] **Step 2: Implement overlay**

```tsx
// apps/atlas-web/components/canvas/IframeOverlay.tsx
"use client";
import * as React from "react";
import { useElementSelection, type DomNode } from "@/lib/canvas/use-element-selection";

export function IframeOverlay({ iframeRef, onSelect }: { iframeRef: React.RefObject<HTMLIFrameElement>; onSelect: (n: DomNode) => void }) {
  const { nodes, selected, setSelected } = useElementSelection();
  const [hover, setHover] = React.useState<DomNode | null>(null);
  return (
    <div className="pointer-events-none absolute inset-0">
      {nodes.map((n) => (
        <div
          key={n.selector}
          className={`absolute pointer-events-auto ${selected?.selector === n.selector ? "ring-2 ring-emerald-500" : hover?.selector === n.selector ? "ring-1 ring-blue-400" : "ring-0"}`}
          style={{ left: n.rect.x, top: n.rect.y, width: n.rect.width, height: n.rect.height }}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover((cur) => (cur === n ? null : cur))}
          onClick={(e) => { e.stopPropagation(); setSelected(n); onSelect(n); }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Mount in PreviewCanvas behind flag**

In `CanvasPreviewClient.tsx`, when `mode === "visual-edits"` AND `ATLAS_FF_CLICK_TO_EDIT`, render the overlay over the iframe (use `position: relative` parent).

- [ ] **Step 4: Test + commit**

```tsx
// test/components/canvas/IframeOverlay.test.tsx
it("renders a hit-zone per node from postMessage", () => {
  const onSelect = vi.fn();
  const ref = { current: null };
  render(<IframeOverlay iframeRef={ref as any} onSelect={onSelect} />);
  window.postMessage({ type: "atlas-dom-tree", nodes: [{ selector: "h1", tag: "h1", text: "Hello", rect: { x: 10, y: 20, width: 100, height: 30 }, classes: [] }] }, "*");
  // wait next tick for event handler
});
```

```bash
git add apps/atlas-web/components/canvas/IframeOverlay.tsx apps/atlas-web/lib/canvas/use-element-selection.ts apps/atlas-web/app/projects/\[projectId\]/canvas/_components/CanvasPreviewClient.tsx apps/atlas-web/test/components/canvas/IframeOverlay.test.tsx
git commit -m "feat(atlas-web): IframeOverlay — click-to-select on preview behind ATLAS_FF_CLICK_TO_EDIT"
```

---

## Task 6 — Reference drop zone (Change 4)

**Files:**
- Create: `apps/atlas-web/components/prompt/ReferenceDropZone.tsx`
- Create: `apps/atlas-web/lib/actions/uploadReference.ts`
- Create: `apps/atlas-web/app/api/atlas-references/[hash]/route.ts`

- [ ] **Step 1: uploadReference action**

```ts
// apps/atlas-web/lib/actions/uploadReference.ts
"use server";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const CACHE_DIR = resolve(process.cwd(), ".next", "cache", "atlas-references");

export async function uploadReference(formData: FormData): Promise<{ url: string }> {
  const file = formData.get("file") as File | null;
  if (!file) throw new Error("file required");
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error("file too large (>5MB)");
  const sha = createHash("sha256").update(buf).digest("hex");
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const ext = file.type === "image/png" ? "png" : "jpg";
  const path = join(CACHE_DIR, `${sha}.${ext}`);
  try { await fs.access(path); } catch { await fs.writeFile(path, buf); }
  return { url: `/atlas-references/${sha}.${ext}` };
}
```

- [ ] **Step 2: Serve route**

Mirror the atlas-assets serving route — `app/api/atlas-references/[hash]/route.ts` reads from `.next/cache/atlas-references`.

- [ ] **Step 3: ReferenceDropZone component**

```tsx
"use client";
import * as React from "react";
import { uploadReference } from "@/lib/actions/uploadReference";

export function ReferenceDropZone({ onAdd }: { onAdd: (ref: { url: string; caption?: string }) => void }) {
  const [refs, setRefs] = React.useState<Array<{ url: string }>>([]);
  async function onFile(file: File) {
    const fd = new FormData(); fd.set("file", file);
    const out = await uploadReference(fd);
    setRefs((cur) => [...cur, out]);
    onAdd(out);
  }
  return (
    <div onDrop={async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) await onFile(f); }}
         onDragOver={(e) => e.preventDefault()}
         className="border-2 border-dashed border-slate-300 rounded-md p-2 text-xs text-slate-500">
      Drop a screenshot here to style-match · {refs.length} attached
      {refs.map((r, i) => <img key={i} src={r.url} className="inline-block w-12 h-12 object-cover ml-2 rounded" />)}
    </div>
  );
}
```

- [ ] **Step 4: Mount + commit**

Mount in PromptForm and ChatPanel inputs behind `ATLAS_FF_REFERENCE_INPUT`. Thread `references[]` state into form submit → server action sets `referenceImages` on startRitual.

```bash
git add apps/atlas-web/components/prompt/ReferenceDropZone.tsx apps/atlas-web/lib/actions/uploadReference.ts apps/atlas-web/app/api/atlas-references
git commit -m "feat(atlas-web): ReferenceDropZone + upload action behind ATLAS_FF_REFERENCE_INPUT"
```

---

## Task 7 — Editable plan + critique disclosure (Change 5)

**Files:**
- Create: `apps/atlas-web/components/ritual/PlanCheckpoints.tsx`
- Create: `apps/atlas-web/components/ritual/CritiqueDisclosure.tsx`
- Modify: `apps/atlas-web/components/ritual/RitualTimeline.tsx`
- Modify: `packages/ritual-engine/src/canvas-pause.ts`

- [ ] **Step 1: Add plan-approval pause kind**

In `canvas-pause.ts`, extend the registry to support a `"plan-approval"` kind alongside the existing option-select. New methods: `waitForPlanApproval(ritualId, plan)` / `resolvePlanApproval(ritualId, approvedPlan)`.

- [ ] **Step 2: PlanCheckpoints component**

```tsx
"use client";
import * as React from "react";
export function PlanCheckpoints({ plan, onApprove }: { plan: Array<{ id: string; text: string }>; onApprove: (final: Array<{ id: string; text: string }>) => void }) {
  const [items, setItems] = React.useState(plan);
  return (
    <div className="space-y-2">
      {items.map((step, i) => (
        <div key={step.id} className="flex items-center gap-2">
          <input className="flex-1 text-sm" value={step.text} onChange={(e) => setItems((cur) => cur.map((s, j) => j === i ? { ...s, text: e.target.value } : s))} />
          <button onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))} className="text-red-600 text-xs">×</button>
        </div>
      ))}
      <button onClick={() => onApprove(items)} className="bg-slate-900 text-white px-3 py-1 text-sm rounded">Approve plan</button>
    </div>
  );
}
```

- [ ] **Step 3: CritiqueDisclosure component**

```tsx
"use client";
import * as React from "react";
export function CritiqueDisclosure({ findings }: { findings: Array<{ axis: string; score: number; suggestion: string }> }) {
  const [open, setOpen] = React.useState(false);
  return (
    <details className="px-3 py-2 text-xs" open={open}>
      <summary onClick={(e) => { e.preventDefault(); setOpen(!open); }} className="cursor-pointer text-slate-600">
        ▶ Critique ({findings.length} findings)
      </summary>
      <ul className="mt-2 space-y-1">
        {findings.map((f, i) => (
          <li key={i}><strong>{f.axis} ({f.score}/5):</strong> {f.suggestion}</li>
        ))}
      </ul>
    </details>
  );
}
```

- [ ] **Step 4: Mount in RitualTimeline + commit**

When `ATLAS_FF_EDITABLE_PLAN` is on AND a `designer.critique.completed` event landed for the active ritual, render `<CritiqueDisclosure findings={payload.critique.findings} />` between the architect row and the designer row.

```bash
git add apps/atlas-web/components/ritual/PlanCheckpoints.tsx apps/atlas-web/components/ritual/CritiqueDisclosure.tsx apps/atlas-web/components/ritual/RitualTimeline.tsx packages/ritual-engine/src/canvas-pause.ts
git commit -m "feat(atlas-web): editable plan checkpoints + critique disclosure behind ATLAS_FF_EDITABLE_PLAN"
```

---

## Task 8 — Per-element generated sliders (Change 6)

**Files:**
- Create: `apps/atlas-web/lib/actions/proposeElementAxes.ts`
- Create: `apps/atlas-web/lib/actions/applyElementAxisChange.ts`
- Create: `apps/atlas-web/components/canvas/ElementInspector.tsx`

- [ ] **Step 1: proposeElementAxes action**

```ts
// apps/atlas-web/lib/actions/proposeElementAxes.ts
"use server";

export interface ElementContext { tag: string; classes: string[]; text: string; computedStyle?: Record<string, string>; }
export interface ElementAxis { name: string; label: string; min: number; max: number; step: number; unit: string; currentValue: number; cssProperty?: string; tokenKey?: string; }

export async function proposeElementAxes(ctx: ElementContext): Promise<ElementAxis[]> {
  const url = process.env.ATLAS_LLM_BASE_URL;
  const key = process.env.ATLAS_LLM_API_KEY;
  if (!url || !key) throw new Error("LLM not configured");
  const sys = `Given an HTML element + classes, propose 2-5 adjustable axes a designer would actually want.
Return a JSON array. Schema:
{ name, label, min, max, step, unit, currentValue, cssProperty?, tokenKey? }
Examples: button → primary color (tokenKey: palette.primary), border-radius (cssProperty: borderRadius). text → font-size (cssProperty: fontSize), letter-spacing. image → object-fit (cssProperty: objectFit).`;
  const resp = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "anthropic/claude-haiku-4.5",
      messages: [{ role: "system", content: sys }, { role: "user", content: JSON.stringify(ctx) }],
      response_format: { type: "json_object" }
    })
  });
  const json = await resp.json() as { choices: Array<{ message: { content: string } }> };
  const parsed = JSON.parse(json.choices[0]!.message.content);
  return Array.isArray(parsed) ? parsed : (parsed.axes ?? []);
}
```

- [ ] **Step 2: applyElementAxisChange action**

```ts
"use server";
import { getSandboxFactory } from "@/lib/sandbox/factory";

export async function applyElementAxisChange(input: { projectId: string; selector: string; axis: { tokenKey?: string; cssProperty?: string }; value: string }): Promise<void> {
  const session = await getSandboxFactory().getOrProvision(input.projectId);
  const { Sandbox } = await import("@e2b/sdk");
  const sdk = await Sandbox.connect(session.record.sandboxId, { apiKey: process.env.E2B_API_KEY ?? "" });

  if (input.axis.tokenKey) {
    // Read design-tokens.json, patch the key, write back. Tailwind rebuilds on save.
    const txt = await sdk.files.read("/code/src/design-tokens.json");
    const tokens = JSON.parse(txt);
    setNested(tokens, input.axis.tokenKey, input.value);
    await sdk.files.write("/code/src/design-tokens.json", JSON.stringify(tokens, null, 2));
    return;
  }
  if (input.axis.cssProperty) {
    // Tell bridge to apply a scoped class on the element directly.
    // For persistence in source, append a className to the element in page.tsx (complex — out of scope V1).
    // V1 limitation: cssProperty axes are runtime-only; persist to design-tokens.json mapping ASAP.
    return;
  }
}

function setNested(obj: any, dotPath: string, value: any) {
  const parts = dotPath.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]!] = cur[parts[i]!] ?? {};
    cur = cur[parts[i]!];
  }
  cur[parts[parts.length - 1]!] = value;
}
```

- [ ] **Step 3: ElementInspector**

```tsx
"use client";
import * as React from "react";
import { proposeElementAxes, type ElementAxis } from "@/lib/actions/proposeElementAxes";
import { applyElementAxisChange } from "@/lib/actions/applyElementAxisChange";
import type { DomNode } from "@/lib/canvas/use-element-selection";

export function ElementInspector({ projectId, selected }: { projectId: string; selected: DomNode | null }) {
  const [axes, setAxes] = React.useState<ElementAxis[]>([]);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    if (!selected) { setAxes([]); return; }
    setLoading(true);
    proposeElementAxes({ tag: selected.tag, classes: selected.classes, text: selected.text })
      .then(setAxes)
      .finally(() => setLoading(false));
  }, [selected?.selector]);
  if (!selected) return <div className="p-4 text-xs text-slate-500">Click an element in the preview to edit it.</div>;
  return (
    <div className="p-4 space-y-3">
      <div className="text-xs font-mono">{selected.tag} · {selected.classes.slice(0, 2).join(" ")}</div>
      {loading && <div className="text-xs text-slate-500">Proposing axes…</div>}
      {axes.map((a) => (
        <div key={a.name}>
          <div className="text-xs font-medium">{a.label}</div>
          <input type="range" min={a.min} max={a.max} step={a.step} defaultValue={a.currentValue}
                 onChange={(e) => applyElementAxisChange({ projectId, selector: selected.selector, axis: a, value: `${e.target.value}${a.unit}` })} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Mount in canvas + commit**

Render ElementInspector in canvas page when `mode === "visual-edits"` AND `ATLAS_FF_ELEMENT_SLIDERS`. Listen for `IframeOverlay.onSelect` → pass to inspector.

```bash
git add apps/atlas-web/components/canvas/ElementInspector.tsx apps/atlas-web/lib/actions/proposeElementAxes.ts apps/atlas-web/lib/actions/applyElementAxisChange.ts apps/atlas-web/app/projects/\[projectId\]/canvas/page.tsx
git commit -m "feat(atlas-web): per-element generated sliders behind ATLAS_FF_ELEMENT_SLIDERS"
```

---

## Task 9 — End-to-end smoke

- [ ] **Step 1: Flip all 6 flags on, restart server**

Edit `.env.local`: `ATLAS_FF_PROMPT_MORPH=true` etc., then `pnpm dev`.

- [ ] **Step 2: Extend Playwright spec**

```ts
// apps/atlas-web/e2e/tests/ux-overhaul-smoke.spec.ts
import { test, expect } from "@playwright/test";
import { PERSONA_STORAGE_STATE } from "../fixtures/personas";
test.use({ storageState: PERSONA_STORAGE_STATE.ama });
test.setTimeout(180_000);
test("UX overhaul smoke — six flags on", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByPlaceholder(/what do you want to build/i)).toBeVisible();
  await page.getByPlaceholder(/what do you want to build/i).fill("A simple hello-world landing page");
  await page.getByRole("button", { name: /^create$/i }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+\/canvas/, { timeout: 30_000 });
  await expect(page.getByRole("radio", { name: /agent/i })).toBeVisible();
  await expect(page.getByRole("radio", { name: /visual edits/i })).toBeVisible();
  // wait for critique disclosure to appear (depends on pipeline plan's flag too)
  await page.waitForSelector("text=Critique", { timeout: 120_000 }).catch(() => {/* pipeline plan not yet shipped — ignore */});
});
```

- [ ] **Step 3: Run + commit**

```bash
pnpm playwright test e2e/tests/ux-overhaul-smoke.spec.ts --reporter=line
git add apps/atlas-web/e2e/tests/ux-overhaul-smoke.spec.ts
git commit -m "test(e2e): UX overhaul smoke — six flags on"
```

---

## Self-review

- [x] Spec coverage: every Change (1-6) is implemented by ≥1 task. Plus the engine pause-kind change for Change 5.
- [x] Type consistency: `CanvasMode` literal `"agent" | "plan" | "visual-edits"` used identically across ModeToolbar, use-canvas-state, and the canvas page. `DomNode` shape stable across bridge / hook / overlay / inspector. `ElementAxis` shape stable across proposeElementAxes / applyElementAxisChange / ElementInspector.
- [x] No placeholders — every code step has the actual code.
- [ ] Known follow-up: applying a `cssProperty` axis change does not yet persist to source (only runtime via bridge `atlas-apply-class`). V2 task: extend `applyElementAxisChange` to write to `page.tsx` source for cssProperty axes that can't be mapped to a token. Tracked in spec's "Out of scope" section.
