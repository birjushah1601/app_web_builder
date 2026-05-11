# Prompt-First New-Project Flow — Design

## Goal

Replace the current `name`-only `/projects/new` form with a prompt-first form that kicks off the ritual immediately on submit and routes the user to the canvas with the architect already running. Also accept an explicit stack hint (Website / Backend / Mobile / Data / Let AI decide) so template selection is deterministic when the user knows what they want, and falls back to architect classification otherwise.

## Motivation

Today the flow is: enter a name → land on canvas → type a prompt in the chat panel → ritual starts. Two roundtrips of dead time before the architect runs. Every comparable tool (v0, Lovable, Bolt) takes the prompt up-front. Atlas should match — and the up-front stack picker has a second benefit: it eliminates a class of architect-classification errors (the classify pass is fine on obvious prompts but gets ambiguous ones wrong, e.g. a "data dashboard for my team" — frontend, backend, or pipeline?).

## Form shape

`/projects/new` becomes a single-screen form with two controls:

1. **Stack picker** — a row of single-select pills above the textarea:
   - 🌐 Website
   - ⚙️ Backend / API
   - 📱 Mobile app
   - 📊 Data pipeline
   - 🤖 Let AI decide (default)
2. **Prompt textarea** — 4-6 rows, placeholder *"What do you want to build? e.g. A landing page for my Mumbai spice kitchen with menu + online ordering"*.
3. **Submit button** — full-width, primary.

The `name` field is removed entirely — name is derived from the prompt.

**Out of scope for V1:**
- CLI-tool pill (smallest segment, bun-cli template is more experimental — add when usage warrants)
- Stack-override after submit (canvas-header badge that recycles the sandbox)
- Architect-suggested rename via `project.renamed` event

## Pill → artifactKind → template

| Pill | `artifactKind` | Template |
|---|---|---|
| 🌐 Website | `frontend-app` | atlas-next-ts-v2 |
| ⚙️ Backend / API | `backend-rest-api` | atlas-fastapi |
| 📱 Mobile app | `mobile-app` | atlas-next-ts-v2 (fallback until expo lands) |
| 📊 Data pipeline | `data-pipeline` | atlas-dlt-python |
| 🤖 Let AI decide | `undefined` | architect classifies, sandbox router maps |

The template column already works today via `apps/atlas-web/lib/sandbox/template-router.ts:templateForArtifactKind`. No router change needed.

## Server action

```ts
// apps/atlas-web/app/projects/new/actions.ts
"use server";

export async function submitPromptedProject(formData: FormData): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");

  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) throw new Error("prompt required");

  const kindRaw = String(formData.get("kind") ?? "auto");
  const artifactKindHint = kindRaw === "auto" ? undefined : (kindRaw as ArtifactKind);

  const name = deriveName(prompt);
  const project = await new ProjectsRepo(pool).create({ userId, name });

  // Fire-and-forget — the canvas page mounts the SSE stream and will
  // pick up the architect's first events. Never await — the user
  // shouldn't wait at the form-submit boundary.
  void startRitual({
    projectId: project.projectId,
    userTurn: prompt,
    ...(artifactKindHint ? { artifactKindHint } : {})
  });

  redirect(`/projects/${project.projectId}/canvas`);
}
```

## Name derivation

`deriveName(prompt: string): string`

- Strip leading verbs ("make me a ", "build a ", "create a "), articles, common stopwords.
- Take the first 5 remaining meaningful words.
- Kebab-case, lowercase, cap at 40 chars.
- If empty after stripping, fall back to `"untitled-" + Date.now().toString(36).slice(-6)`.
- Pure function, lives in `apps/atlas-web/lib/projects/derive-name.ts`. Easy to unit test.

Examples:
- "A landing page for my Mumbai spice kitchen" → `landing-page-mumbai-spice-kitchen`
- "Build a CRUD api for a todo app" → `crud-api-todo-app`
- "asdfasdf" → `asdfasdf`
- "" (impossible — submit blocks) → unreachable

## artifactKindHint plumbing

`startRitual` already accepts a userTurn. Add an optional `artifactKindHint` field that flows through:

1. `apps/atlas-web/lib/actions/startRitual.ts` — adds optional `artifactKindHint?: ArtifactKind` to its input.
2. `packages/ritual-engine/src/engine.ts:start()` — accepts an optional hint, threads it into the `RoleInvocation` as `priorArtifact.artifactKindHint` (or a new field — pick the cleanest spot during implementation).
3. `packages/role-architect/src/role.ts` — if `priorArtifact.artifactKindHint` is set, the architect:
   - Skips the classify pass on `artifactKind`.
   - Sets `canvasManifest.artifactKind` to the hint directly.
   - The rest of pass1 (scope detection, edit-class) runs unchanged.

The hint is advisory — the architect still emits a full canvasManifest. The hint just locks one field.

## Removals

- `bootstrap=1&name=...` query params on `/projects/[id]/canvas` — no longer needed. The canvas page reads the running ritual from `getLatestRitualForProject` (already wired). Remove the bootstrap handler.
- The current `createProject` server action's name-only contract.

## Tests

- `deriveName.test.ts` — covers verb-stripping, kebab-casing, length cap, fallback.
- `submitPromptedProject.test.ts` — mock `ProjectsRepo` + `startRitual`, assert (a) createProject called with derived name, (b) startRitual called with prompt + optional hint, (c) redirect target, (d) empty prompt throws.
- `architect-with-hint.test.ts` (in `role-architect`) — when `artifactKindHint` is set, classify pass is skipped + canvasManifest.artifactKind matches hint.
- `new-project-form.test.tsx` — pill defaults to "auto", clicking a pill changes the form data, submit posts both fields.

## Risks

- **Race**: user lands on canvas before ritual writes the first event. Canvas should render an "Architect is thinking…" empty state for the first few seconds. Already handled by RitualTimeline's empty state — verify it kicks in before the first event arrives.
- **Server action error visibility**: if `submitPromptedProject` throws after createProject succeeds (e.g., startRitual rejects synchronously), the project exists but no ritual is running. The user lands on canvas, sees nothing. Solution: wrap `startRitual` call in try-catch, log the failure, surface a one-shot toast on the canvas page via search-param.
- **Architect ignores the hint**: if a developer modifies the architect prompt and forgets the hint check, we silently fall back to classify. Mitigation: the unit test in `role-architect` catches it.

## Out-of-scope but worth tracking

- Editing the prompt after submit (the user might realize they wrote a typo). Today they'd refine in chat; that's fine for V1 but a "fix the original prompt" affordance would be a nice add.
- Stack-override mid-ritual. Today you'd have to delete the project. Future enhancement: a "switch template" action that pauses the ritual, recycles the sandbox, re-runs from architect.
