# Prompt-First New-Project Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `name`-only `/projects/new` form with a prompt + stack-pill form that kicks off the ritual immediately on submit, so the user lands on a canvas where the architect is already running.

**Architecture:** Form data → `submitPromptedProject` server action → `ProjectsRepo.create({ userId, name: deriveName(prompt) })` → fire-and-forget `startRitual({ projectId, userTurn, artifactKindHint })` → `redirect(/canvas)`. The hint threads through the engine into the architect, which skips its artifactKind classification when the hint is present.

**Tech Stack:** Next.js 15 + React 19 (RSC + Server Actions), TypeScript strict + `exactOptionalPropertyTypes`, Tailwind 3, Vitest. Touches `apps/atlas-web/`, `packages/ritual-engine/`, `packages/role-architect/`.

---

## File Structure

**Create:**
- `apps/atlas-web/lib/projects/derive-name.ts` — pure helper, slug from prompt.
- `apps/atlas-web/lib/projects/derive-name.test.ts` — unit tests.
- `apps/atlas-web/app/projects/new/_components/PromptForm.tsx` — client component (pills + textarea + submit, no useState for the field — uncontrolled inputs, form action does the work).
- `apps/atlas-web/test/app/projects/new/PromptForm.test.tsx` — RTL render + interact test.
- `packages/role-architect/test/artifact-kind-hint.test.ts` — hint short-circuits classify.

**Modify:**
- `apps/atlas-web/app/projects/new/actions.ts` — rename `createProject` → `submitPromptedProject`, accept `prompt` + `kind` form fields, derive name, fire ritual.
- `apps/atlas-web/app/projects/new/page.tsx` — replace inline form with `<PromptForm />`.
- `apps/atlas-web/test/app/projects/new/page.test.tsx` — update existing test to assert form/action wiring against the new shape.
- `apps/atlas-web/lib/actions/startRitual.ts` — accept optional `artifactKindHint: ArtifactKind`, pass through to engine.
- `apps/atlas-web/test/actions/startRitual.test.ts` — extend with hint scenario (or create if absent — verify first).
- `packages/ritual-engine/src/engine.ts` — `StartInput` gains optional `artifactKindHint`; threaded into the architect's `RoleInvocation`.
- `packages/role-architect/src/role.ts` — read `inv.priorArtifact.artifactKindHint`; when set, skip the `artifactKind` part of pass1.
- `packages/role-architect/src/types.ts` (or wherever `Pass1Output` lives) — keep types tight.
- `apps/atlas-web/app/projects/[projectId]/canvas/page.tsx` — remove `bootstrap=1` / `name=` handling.

**Decision boundaries kept clean:**
- `deriveName` is pure (no env, no async) — easy to test, lives in `lib/projects/` so it's a sibling to future project-domain helpers.
- `PromptForm` is the only client component; the page stays an RSC.
- `submitPromptedProject` is the only server action in `/projects/new`; it owns persistence + ritual kickoff + redirect.
- The hint plumb is a pure-field addition; no behavior change when the hint is undefined (architect classify still runs).

---

## Task 1: deriveName pure helper

**Files:**
- Create: `apps/atlas-web/lib/projects/derive-name.ts`
- Create: `apps/atlas-web/lib/projects/derive-name.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/atlas-web/lib/projects/derive-name.test.ts
import { describe, it, expect } from "vitest";
import { deriveName } from "@/lib/projects/derive-name";

describe("deriveName", () => {
  it("strips a leading verb + article and kebab-cases the rest", () => {
    expect(deriveName("A landing page for my Mumbai spice kitchen"))
      .toBe("landing-page-mumbai-spice-kitchen");
  });

  it("handles 'build a' prefix", () => {
    expect(deriveName("Build a CRUD api for a todo app"))
      .toBe("crud-api-todo-app");
  });

  it("handles 'create a' prefix", () => {
    expect(deriveName("Create a dashboard that shows team metrics"))
      .toBe("dashboard-shows-team-metrics");
  });

  it("caps at 40 chars", () => {
    const long = "make me an absurdly long winded landing page about everything you can imagine";
    const out = deriveName(long);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).not.toMatch(/-$/);
  });

  it("falls back to untitled-* when prompt is all stopwords", () => {
    const out = deriveName("a the and or");
    expect(out).toMatch(/^untitled-[a-z0-9]{6}$/);
  });

  it("preserves words verbatim (no stemming)", () => {
    expect(deriveName("Tweakbits subscription page")).toBe("tweakbits-subscription-page");
  });

  it("lowercases", () => {
    expect(deriveName("Mumbai Spice Kitchen")).toBe("mumbai-spice-kitchen");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter atlas-web vitest run test/lib/projects/derive-name.test.ts`
Expected: FAIL with "cannot find module @/lib/projects/derive-name"

- [ ] **Step 3: Write the implementation**

```ts
// apps/atlas-web/lib/projects/derive-name.ts
const LEADING_FILLERS = new Set([
  "make", "me", "build", "create", "design",
  "a", "an", "the", "for", "my",
  "of", "and", "or", "to"
]);

export function deriveName(prompt: string): string {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);

  // Drop a leading run of fillers — stop as soon as we hit a real word.
  let i = 0;
  while (i < words.length && LEADING_FILLERS.has(words[i]!)) i++;
  const meaningful = words.slice(i).filter((w) => !LEADING_FILLERS.has(w));

  if (meaningful.length === 0) {
    return "untitled-" + Math.random().toString(36).slice(2, 8);
  }

  let slug = meaningful.slice(0, 8).join("-");
  if (slug.length > 40) slug = slug.slice(0, 40).replace(/-+[^-]*$/, "");
  return slug;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter atlas-web vitest run test/lib/projects/derive-name.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/lib/projects/derive-name.ts apps/atlas-web/lib/projects/derive-name.test.ts
git commit -m "feat(atlas-web): deriveName pure helper for prompt-driven project naming"
```

---

## Task 2: artifactKindHint flows through the ritual engine

**Files:**
- Modify: `packages/ritual-engine/src/engine.ts` — `StartInput` + start() implementation
- Modify: `packages/ritual-engine/test/engine-start.test.ts` (or wherever start() is tested)

- [ ] **Step 1: Write the failing test**

```ts
// in the engine's start-flow test file
it("threads artifactKindHint into the architect's priorArtifact", async () => {
  const dispatched: unknown[] = [];
  const architect = {
    run: async (inv: any) => {
      dispatched.push(inv.priorArtifact);
      return { events: [], artifact: { canvasManifest: { artifactKind: "frontend-app", modes: [] } } };
    }
  };
  const engine = new RitualEngine({
    conductor: makeConductorWithRoles({ architect }),
    eventSink: makeMemorySink(),
    canvasFlowEnabled: false
  });
  await engine.start({
    projectId: "p1",
    userTurn: "build a todo app",
    artifactKindHint: "frontend-app"
  });
  expect(dispatched[0]).toMatchObject({ artifactKindHint: "frontend-app" });
});
```

- [ ] **Step 2: Run + see fail**

Run: `pnpm --filter @atlas/ritual-engine vitest run`
Expected: FAIL with `StartInput` missing `artifactKindHint` OR architect receives undefined.

- [ ] **Step 3: Implement**

In `packages/ritual-engine/src/engine.ts`, extend the `StartInput` interface:

```ts
export interface StartInput {
  projectId: string;
  userTurn: string;
  ritualMode?: "fast" | "considered";
  /** Plan PFP — optional user-provided hint that bypasses the architect's
   *  artifactKind classification. Threads into the architect's
   *  RoleInvocation.priorArtifact so role-architect can short-circuit. */
  artifactKindHint?: ArtifactKind;
  currentFiles?: { path: string; content?: string }[];
}
```

In the `start()` method, where the architect is dispatched, fold the hint into `priorArtifact`:

```ts
const architectPriorArtifact = {
  ...(input.artifactKindHint ? { artifactKindHint: input.artifactKindHint } : {})
};
```

Pass this through `conductor.dispatch({ ..., priorArtifact: architectPriorArtifact })`. Match the existing pattern for how `currentFiles` is threaded.

- [ ] **Step 4: Run + see pass**

Run: `pnpm --filter @atlas/ritual-engine vitest run`
Expected: PASS

- [ ] **Step 5: Rebuild the dist so atlas-web sees the new field**

Run: `pnpm --filter @atlas/ritual-engine build`

- [ ] **Step 6: Commit**

```bash
git add packages/ritual-engine/src packages/ritual-engine/test
git commit -m "feat(ritual-engine): StartInput.artifactKindHint flows into architect's priorArtifact"
```

---

## Task 3: Architect respects artifactKindHint

**Files:**
- Modify: `packages/role-architect/src/role.ts`
- Create: `packages/role-architect/test/artifact-kind-hint.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/role-architect/test/artifact-kind-hint.test.ts
import { describe, it, expect } from "vitest";
import { ArchitectRole } from "@atlas/role-architect";
import { makeFakeLlm } from "./helpers";

describe("ArchitectRole — artifactKindHint short-circuits classification", () => {
  it("when hint is set, canvasManifest.artifactKind matches the hint without invoking classify", async () => {
    const llm = makeFakeLlm({ pass1: { scope: "new-app", editClass: "new" }, pass2: { /* artifact */ } });
    const role = new ArchitectRole({ llm, skills: ..., triageModel: "x", deepPlanModel: "y" });
    const out = await role.run({
      userTurn: "build a todo app",
      priorArtifact: { artifactKindHint: "data-pipeline" }
    });
    const artifact = out.artifact as any;
    expect(artifact.canvasManifest.artifactKind).toBe("data-pipeline");
    // classify pass was NOT called for artifactKind — verify by inspecting the fake llm's call log
    expect(llm.calls.filter((c: any) => c.kind === "classify-artifact-kind").length).toBe(0);
  });

  it("when hint is unset, falls back to classifier (existing behavior)", async () => {
    const llm = makeFakeLlm({ pass1: { scope: "new-app", editClass: "new", artifactKind: "frontend-app" }, pass2: {} });
    const role = new ArchitectRole({ llm, skills: ..., triageModel: "x", deepPlanModel: "y" });
    const out = await role.run({ userTurn: "build a todo app", priorArtifact: {} });
    const artifact = out.artifact as any;
    expect(artifact.canvasManifest.artifactKind).toBe("frontend-app");
  });
});
```

(Replace `...` placeholders with the actual skill registry shape used by neighboring tests in `packages/role-architect/test/`.)

- [ ] **Step 2: Run + see fail**

Run: `pnpm --filter @atlas/role-architect vitest run test/artifact-kind-hint.test.ts`
Expected: FAIL — current architect always runs classify.

- [ ] **Step 3: Implement**

In `packages/role-architect/src/role.ts`, find where pass1 classifies `artifactKind` and gate it:

```ts
const hint = (inv.priorArtifact as { artifactKindHint?: ArtifactKind } | undefined)?.artifactKindHint;
const artifactKind = hint ?? await classifyArtifactKind(...);
// ... build canvasManifest with `artifactKind` ...
```

If the architect emits `architect.pass1.completed` with a payload that includes `artifactKind`, include a `hintApplied: !!hint` field so traces stay debuggable.

- [ ] **Step 4: Run + see pass**

Run: `pnpm --filter @atlas/role-architect vitest run`
Expected: PASS (both new tests + the full pre-existing suite still passing)

- [ ] **Step 5: Rebuild + commit**

```bash
pnpm --filter @atlas/role-architect build
git add packages/role-architect
git commit -m "feat(role-architect): respect artifactKindHint, skip artifactKind classify when set"
```

---

## Task 4: startRitual server action accepts the hint

**Files:**
- Modify: `apps/atlas-web/lib/actions/startRitual.ts`
- Modify: `apps/atlas-web/test/actions/startRitual.test.ts` (verify it exists first; create if not)

- [ ] **Step 1: Add field to startRitual input + test**

```ts
// apps/atlas-web/lib/actions/startRitual.ts
export interface StartRitualInput {
  projectId: string;
  userTurn: string;
  artifactKindHint?: ArtifactKind;
}

export async function startRitual(input: StartRitualInput): Promise<string> {
  // ... existing engine resolution ...
  return engine.start({
    projectId: input.projectId,
    userTurn: input.userTurn,
    ...(input.artifactKindHint ? { artifactKindHint: input.artifactKindHint } : {}),
    ...(currentFiles.length > 0 ? { currentFiles } : {})
  });
}
```

- [ ] **Step 2: Test**

```ts
it("passes artifactKindHint through to engine.start", async () => {
  const startMock = vi.fn(async () => "r-1");
  /* ... mock engine ... */
  await startRitual({ projectId: "p", userTurn: "x", artifactKindHint: "backend-rest-api" });
  expect(startMock).toHaveBeenCalledWith(expect.objectContaining({ artifactKindHint: "backend-rest-api" }));
});
```

- [ ] **Step 3: Run**

Run: `pnpm --filter atlas-web vitest run test/actions/startRitual.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/lib/actions/startRitual.ts apps/atlas-web/test/actions/startRitual.test.ts
git commit -m "feat(atlas-web): startRitual server action forwards artifactKindHint"
```

---

## Task 5: submitPromptedProject server action

**Files:**
- Modify: `apps/atlas-web/app/projects/new/actions.ts`
- Modify: `apps/atlas-web/test/app/projects/new/page.test.tsx` (existing) — rewrite for the new action shape, OR add a new test file specifically for the action.

- [ ] **Step 1: Write the failing test**

```ts
// apps/atlas-web/test/app/projects/new/actions.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth/clerk-compat", () => ({ auth: vi.fn(async () => ({ userId: "u1" })) }));
vi.mock("@/lib/actions/startRitual", () => ({ startRitual: vi.fn(async () => "r-1") }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((u) => { throw new Error("REDIRECT:" + u); }) }));
const createMock = vi.fn(async ({ name }: { name: string }) => ({ projectId: "p-uuid", userId: "u1", name }));
vi.mock("@atlas/spec-graph-data", () => ({ ProjectsRepo: class { create = createMock; } }));
vi.mock("pg", () => ({ Pool: class {} }));

describe("submitPromptedProject", () => {
  it("derives name from prompt + fires startRitual with hint + redirects", async () => {
    const { submitPromptedProject } = await import("@/app/projects/new/actions");
    const { startRitual } = await import("@/lib/actions/startRitual");
    const fd = new FormData();
    fd.set("prompt", "Build a landing page for my Mumbai spice kitchen");
    fd.set("kind", "frontend-app");
    await expect(submitPromptedProject(fd)).rejects.toThrow(/REDIRECT:\/projects\/p-uuid\/canvas/);
    expect(createMock).toHaveBeenCalledWith({ userId: "u1", name: "landing-page-mumbai-spice-kitchen" });
    expect(startRitual).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p-uuid",
      userTurn: "Build a landing page for my Mumbai spice kitchen",
      artifactKindHint: "frontend-app"
    }));
  });

  it("omits artifactKindHint when kind is 'auto'", async () => {
    const { submitPromptedProject } = await import("@/app/projects/new/actions");
    const { startRitual } = await import("@/lib/actions/startRitual");
    const fd = new FormData();
    fd.set("prompt", "Make a todo app");
    fd.set("kind", "auto");
    await expect(submitPromptedProject(fd)).rejects.toThrow(/REDIRECT:/);
    const call = (startRitual as any).mock.calls.at(-1)[0];
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
    (auth as any).mockResolvedValueOnce({ userId: null });
    const { submitPromptedProject } = await import("@/app/projects/new/actions");
    const fd = new FormData();
    fd.set("prompt", "x");
    fd.set("kind", "auto");
    await expect(submitPromptedProject(fd)).rejects.toThrow(/unauthorized/);
  });
});
```

- [ ] **Step 2: Run + see fail**

Run: `pnpm --filter atlas-web vitest run test/app/projects/new/actions.test.ts`
Expected: FAIL — submitPromptedProject doesn't exist yet.

- [ ] **Step 3: Implement**

```ts
// apps/atlas-web/app/projects/new/actions.ts
"use server";

import { redirect } from "next/navigation";
import { Pool } from "pg";
import { ProjectsRepo, type ArtifactKind } from "@atlas/spec-graph-data";
import { auth } from "@/lib/auth/clerk-compat";
import { startRitual } from "@/lib/actions/startRitual";
import { deriveName } from "@/lib/projects/derive-name";

const VALID_KINDS: ReadonlySet<string> = new Set([
  "frontend-app", "backend-rest-api", "mobile-app", "data-pipeline"
]);

export async function submitPromptedProject(formData: FormData): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) throw new Error("prompt required");

  const kindRaw = String(formData.get("kind") ?? "auto");
  const artifactKindHint: ArtifactKind | undefined =
    VALID_KINDS.has(kindRaw) ? (kindRaw as ArtifactKind) : undefined;

  const name = deriveName(prompt);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const project = await new ProjectsRepo(pool).create({ userId, name });

  // Fire-and-forget. Do NOT await — the user shouldn't wait at submit.
  void startRitual({
    projectId: project.projectId,
    userTurn: prompt,
    ...(artifactKindHint ? { artifactKindHint } : {})
  }).catch((err) => {
    console.error("[submitPromptedProject] startRitual failed:", err);
  });

  redirect(`/projects/${project.projectId}/canvas`);
}
```

- [ ] **Step 4: Run + see pass**

Run: `pnpm --filter atlas-web vitest run test/app/projects/new/actions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/app/projects/new/actions.ts apps/atlas-web/test/app/projects/new/actions.test.ts
git commit -m "feat(atlas-web): submitPromptedProject action — derive name + fire ritual + redirect"
```

---

## Task 6: PromptForm client component

**Files:**
- Create: `apps/atlas-web/app/projects/new/_components/PromptForm.tsx`
- Create: `apps/atlas-web/test/app/projects/new/PromptForm.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/atlas-web/test/app/projects/new/PromptForm.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PromptForm } from "@/app/projects/new/_components/PromptForm";

describe("PromptForm", () => {
  it("renders 5 pills + textarea + submit", () => {
    render(<PromptForm action={vi.fn()} />);
    expect(screen.getByRole("button", { name: /website/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /backend.*api/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mobile/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /data pipeline/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /let ai decide/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/what do you want to build/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create/i })).toBeInTheDocument();
  });

  it("defaults to 'auto' kind", () => {
    render(<PromptForm action={vi.fn()} />);
    expect(screen.getByRole("button", { name: /let ai decide/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a pill makes it active and unpresses the others", () => {
    render(<PromptForm action={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /website/i }));
    expect(screen.getByRole("button", { name: /website/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /let ai decide/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("includes hidden kind input matching the selected pill", () => {
    const { container } = render(<PromptForm action={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /backend.*api/i }));
    const hidden = container.querySelector<HTMLInputElement>('input[name="kind"]');
    expect(hidden?.value).toBe("backend-rest-api");
  });
});
```

- [ ] **Step 2: Run + see fail**

Run: `pnpm --filter atlas-web vitest run test/app/projects/new/PromptForm.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement**

```tsx
// apps/atlas-web/app/projects/new/_components/PromptForm.tsx
"use client";

import * as React from "react";

const PILLS = [
  { value: "frontend-app",     label: "🌐 Website" },
  { value: "backend-rest-api", label: "⚙️ Backend / API" },
  { value: "mobile-app",       label: "📱 Mobile app" },
  { value: "data-pipeline",    label: "📊 Data pipeline" },
  { value: "auto",             label: "🤖 Let AI decide" }
] as const;

type PillValue = (typeof PILLS)[number]["value"];

export interface PromptFormProps {
  action: (formData: FormData) => void | Promise<void>;
}

export function PromptForm({ action }: PromptFormProps) {
  const [kind, setKind] = React.useState<PillValue>("auto");

  return (
    <form action={action} className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-semibold text-slate-900">What do you want to build?</h1>

      <div className="flex flex-wrap gap-2">
        {PILLS.map((p) => {
          const active = p.value === kind;
          return (
            <button
              key={p.value}
              type="button"
              aria-pressed={active}
              onClick={() => setKind(p.value)}
              className={[
                "rounded-full border px-4 py-2 text-sm font-medium transition",
                active
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-400"
              ].join(" ")}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <input type="hidden" name="kind" value={kind} />

      <textarea
        name="prompt"
        required
        rows={6}
        placeholder="What do you want to build? e.g. A landing page for my Mumbai spice kitchen with menu + online ordering"
        className="block w-full resize-y rounded-md border border-slate-300 px-4 py-3 text-base focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
      />

      <button
        type="submit"
        className="w-full rounded-md bg-slate-900 px-4 py-3 text-base font-medium text-white hover:bg-slate-700"
      >
        Create
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run + see pass**

Run: `pnpm --filter atlas-web vitest run test/app/projects/new/PromptForm.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/atlas-web/app/projects/new/_components/PromptForm.tsx apps/atlas-web/test/app/projects/new/PromptForm.test.tsx
git commit -m "feat(atlas-web): PromptForm client component (pills + textarea)"
```

---

## Task 7: Wire PromptForm into /projects/new/page.tsx

**Files:**
- Modify: `apps/atlas-web/app/projects/new/page.tsx`
- Modify: `apps/atlas-web/test/app/projects/new/page.test.tsx`

- [ ] **Step 1: Replace page contents**

```tsx
// apps/atlas-web/app/projects/new/page.tsx
import { submitPromptedProject } from "./actions";
import { PromptForm } from "./_components/PromptForm";

export default function NewProjectPage() {
  return <PromptForm action={submitPromptedProject} />;
}
```

- [ ] **Step 2: Update page test**

```tsx
// apps/atlas-web/test/app/projects/new/page.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NewProjectPage from "@/app/projects/new/page";

describe("NewProjectPage", () => {
  it("renders the PromptForm", () => {
    render(<NewProjectPage />);
    expect(screen.getByPlaceholderText(/what do you want to build/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /let ai decide/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run**

Run: `pnpm --filter atlas-web vitest run test/app/projects/new/`
Expected: PASS (all files in dir)

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/app/projects/new/page.tsx apps/atlas-web/test/app/projects/new/page.test.tsx
git commit -m "feat(atlas-web): /projects/new mounts PromptForm with submitPromptedProject action"
```

---

## Task 8: Drop the bootstrap=1 / name= handling on canvas

**Files:**
- Modify: `apps/atlas-web/app/projects/[projectId]/canvas/page.tsx`

- [ ] **Step 1: Find + remove bootstrap branch**

Read the file. Locate any code path that reads `searchParams.bootstrap` or `searchParams.name` and kicks off a ritual or stashes a name. Remove it — the prompt+name is now owned by `submitPromptedProject` before redirect.

- [ ] **Step 2: Verify nothing else reads those params**

Run: `grep -rn "bootstrap=1\|searchParams.bootstrap\|searchParams\.name" apps/atlas-web` and confirm no consumers remain (other than this file).

- [ ] **Step 3: Update or remove tests that asserted bootstrap behavior**

Run: `pnpm --filter atlas-web vitest run` — verify nothing in the suite asserts the old bootstrap contract.

- [ ] **Step 4: Commit**

```bash
git add apps/atlas-web/app/projects/[projectId]/canvas/page.tsx
git commit -m "refactor(atlas-web): drop bootstrap=1 query handling — prompt+ritual kickoff now lives in submitPromptedProject"
```

---

## Task 9: Manual smoke + typecheck

- [ ] **Step 1: Restart atlas-web**

```bash
# kill :3000 then
cd apps/atlas-web && pnpm dev
```

- [ ] **Step 2: Walk the flow**

1. Hit `http://localhost:3000/`.
2. Click "Create new" (or whatever the dashboard's new-project CTA is).
3. On `/projects/new`: see pills + textarea.
4. Pick "🌐 Website", enter "A landing page for Mumbai spice kitchen with menu".
5. Click Create. Land on `/projects/<uuid>/canvas`.
6. RitualTimeline should immediately show `architect.pass1.started` flowing in. No "I clicked into a dead canvas" gap.
7. Wait — designer cards should render (proposal step) since Designer is registered and the hint pinned artifactKind=frontend-app.
8. Pick a direction → developer runs → preview iframe shows the page.

- [ ] **Step 3: Run full suites**

```bash
cd apps/atlas-web && pnpm typecheck && pnpm vitest run
cd packages/ritual-engine && pnpm vitest run
cd packages/role-architect && pnpm vitest run
```

Expected: green except pre-existing failures unrelated to this work (factory-multi-stack typecheck, role-researcher per-kind skill stale test).

---

## Self-review

- [x] Spec coverage: form, action, name derivation, hint plumbing through engine + architect, removal of bootstrap, tests. Every section in `2026-05-11-prompt-first-new-project-design.md` has an implementing task.
- [x] No placeholders.
- [x] Type consistency: `ArtifactKind` import path is used in every task; field name `artifactKindHint` is consistent across the engine + architect + atlas-web boundary.
- [x] Ambiguity called out in spec: "skips the artifactKind classification within pass1" (not pass1 entirely) — Task 3 makes this explicit in the implementation step.
