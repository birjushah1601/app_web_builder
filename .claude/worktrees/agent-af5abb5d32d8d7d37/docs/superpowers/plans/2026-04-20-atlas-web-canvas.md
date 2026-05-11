# Atlas Web Scaffold + Canvas View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apps/atlas-web/` — the Next.js 15 App Router product surface for Atlas. E.2 delivers the scaffold (Next.js + Tailwind + Clerk auth + workspace dep wiring), the **Canvas view** (React Flow rendering of Spec Graph nodes with drag-rearrange + click-to-edit), the persona-toggle UI, and the Server-Action layer that calls `@atlas/ritual-engine`. The Code view (Monaco) lands with E.3; the E2B sandbox + preview lands with E.4; end-to-end Playwright tests land with E.5. E.2 ships a route-shell stub for the Code view so navigation + persona-tier defaults already work.

**Architecture:** Server Components hold the Spec Graph slice + ritual state for each request, hydrating Client Components for interactive surfaces (Canvas via React Flow, chat panel, persona toggle). Server Actions wrap `@atlas/ritual-engine` — `startRitual`, `approveRitual`, `acceptRiskAction`, `escalateRitual` — so the engine never touches the browser directly. Authentication: Clerk via `@clerk/nextjs` middleware; an `AuthProvider` interface keeps Clerk swappable. The engine's `EventSink` writes through `@atlas/spec-graph-data.spec_events`; a thin SSE endpoint (`/api/projects/[projectId]/events`) tails the same stream so the chat panel can render `ritual.transitioned` events live. Persona preferences: per-user default in Clerk metadata; per-project override in a new `user_project_preferences` table.

**Tech Stack:** Next.js 15 (App Router) · React 18.3 · TypeScript 5.6.3 · Tailwind CSS 3.4 · `@xyflow/react` (React Flow) latest · `@clerk/nextjs` latest · Vitest 2.1.8 · @testing-library/react 16.x · Node 22 LTS. Workspace deps: `@atlas/ritual-engine`, `@atlas/conductor`, `@atlas/spec-graph-data`, `@atlas/spec-graph-schema`, `@atlas/skill-runtime`, `@atlas/role-architect`.

**Prerequisites the implementing engineer needs installed before starting:**
- Plans A.1–A.4, B.1, C.1–C.2, D.1–D.2, E.1 merged.
- Node 22 LTS + pnpm 9+.
- Clerk dev account (free tier) with publishable + secret keys.
- Postgres on port 5433 (A.1's docker-compose) for Server Action tests + the user_project_preferences migration.

---

## File Structure

```
apps/
  atlas-web/                                 # NEW — Next.js 15 App Router
    package.json
    next.config.mjs
    tsconfig.json
    tailwind.config.ts
    postcss.config.mjs
    middleware.ts                            # Clerk middleware
    .env.example                             # Clerk + DB env vars
    README.md
    app/
      layout.tsx                             # Root layout — Clerk provider, Tailwind base, persona toggle in top bar
      page.tsx                               # Landing — list of user's projects + new-project CTA
      globals.css                            # Tailwind base
      sign-in/[[...sign-in]]/page.tsx        # Clerk sign-in route
      sign-up/[[...sign-up]]/page.tsx        # Clerk sign-up route
      projects/
        [projectId]/
          layout.tsx                         # Per-project shell — persona toggle, Canvas/Code tab nav
          page.tsx                           # Redirect to /canvas (default for Ama+Diego) or /code (Priya default)
          canvas/
            page.tsx                         # Canvas view — Server Component fetches graph, hydrates <CanvasClient>
          code/
            page.tsx                         # E.2 stub — placeholder file list; Monaco lands in E.3
        new/
          page.tsx                           # New-project form
      api/
        projects/[projectId]/events/route.ts # SSE endpoint tailing spec_events for the chat panel
    components/
      CanvasClient.tsx                       # React Flow wrapper (Client Component)
      ChatPanel.tsx                          # Right-side chat that drives RitualEngine.start()
      ApprovalPanel.tsx                      # Renders artifact + persona-tiered approval buttons
      RiskAcceptModal.tsx                    # 20-char rationale validator + persona gate UI
      PersonaToggle.tsx                      # Top-bar Ama/Diego/Priya selector
      EscalationCallout.tsx                  # Renders when persona-blocked from a risk-accept
    lib/
      auth/
        provider.ts                          # AuthProvider interface
        clerk-provider.ts                    # Clerk implementation
      engine/
        factory.ts                           # Per-request RitualEngine factory (singleton via React cache)
        persona-prefs.ts                     # PersonaPreferences impl reading Clerk + user_project_preferences
        event-sink.ts                        # EventSink wired to @atlas/spec-graph-data
      actions/
        startRitual.ts                       # "use server" action
        approveRitual.ts
        acceptRiskAction.ts
        escalateRitual.ts
        setPersonaOverride.ts
    test/
      components/
        CanvasClient.test.tsx
        ChatPanel.test.tsx
        ApprovalPanel.test.tsx
        RiskAcceptModal.test.tsx
        PersonaToggle.test.tsx
      actions/
        startRitual.test.ts
        approveRitual.test.ts
        acceptRiskAction.test.ts
      lib/
        engine/factory.test.ts
        engine/persona-prefs.test.ts
    vitest.config.ts                         # JSDOM env for component tests
    vitest.setup.ts                          # Testing Library globals + Clerk mocks

packages/spec-graph-data/                    # MODIFIED
  src/repo/preferences-repo.ts               # NEW — user_project_preferences accessor
  src/schema/migrations/00NN_user_project_preferences.sql  # NEW
  test/repo/preferences-repo.test.ts         # NEW

docs/superpowers/plans/
  README.md                                  # MODIFIED — add E.2 entry
```

**Why this shape.** Server Components own data fetching + auth gating; Client Components own interactivity. The `lib/engine/factory.ts` returns a per-request `RitualEngine` singleton (via React's `cache` helper) so multiple Server Actions in the same render share state. Persona preferences live in two places: Clerk metadata (default) and `user_project_preferences` (per-project override) — the per-request factory consults both via `PersonaPreferences`. The `AuthProvider` interface boxes Clerk so a future swap to Supabase Auth or Lucia is a localized refactor, not a rewrite.

## Open-question resolutions

- **OQ1 (auth provider) → Clerk for v1.** Boxed behind an `AuthProvider` interface in `lib/auth/provider.ts`. The interface has `getCurrentUserId()`, `getCurrentUserEmail()`, and `signInUrl(returnTo)`. Clerk implementation in `lib/auth/clerk-provider.ts`; tests inject a mock.
- **OQ3 (Canvas rendering tech) → React Flow for the graph view; custom SVG cards for the wireframe overlay.** React Flow's node-types map to Spec Graph node-kinds (Page = "page" node, Component = "component" node, etc.). Custom node renderers (in `components/CanvasClient.tsx`'s `nodeTypes` prop) draw card-style wireframes for Pages.
- **OQ4 (persona toggle persistence) → already resolved in E.1.** This plan implements the storage half: per-user default in Clerk metadata; per-project override in the new `user_project_preferences` table.
- **OQ5 (risk-accept UX for Ama) → already resolved in E.1.** This plan implements the UI half: when `acceptRiskAction` throws `PersonaGateError`, the `RiskAcceptModal` swaps to an `EscalationCallout` with an "Ask Priya for review" CTA that emits `ritual.escalation_requested`.

---

## Tasks

### Task 1: Scaffold `apps/atlas-web/` with Next.js 15

**Files:** new app shell.

- [ ] **Step 1: Create the Next.js app**

```bash
mkdir -p apps
cd apps
npx create-next-app@latest atlas-web --typescript --tailwind --app --no-src-dir --import-alias "@/*" --eslint --skip-install --use-pnpm
cd ..
```

When prompted, accept defaults (App Router yes, Tailwind yes, src dir no, alias `@/*`).

- [ ] **Step 2: Add workspace + auth deps to package.json**

Edit `apps/atlas-web/package.json`. Replace the generated `dependencies` and `devDependencies` blocks with:

```json
  "dependencies": {
    "@atlas/conductor": "workspace:*",
    "@atlas/ritual-engine": "workspace:*",
    "@atlas/role-architect": "workspace:*",
    "@atlas/skill-runtime": "workspace:*",
    "@atlas/spec-graph-data": "workspace:*",
    "@atlas/spec-graph-schema": "workspace:*",
    "@clerk/nextjs": "^6.0.0",
    "@xyflow/react": "^12.3.0",
    "next": "15.0.0",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "22.9.0",
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "autoprefixer": "^10.4.20",
    "eslint": "^9",
    "eslint-config-next": "15.0.0",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.14",
    "typescript": "5.6.3",
    "vitest": "2.1.8"
  }
```

- [ ] **Step 3: Add scripts to package.json**

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
```

- [ ] **Step 4: Write `apps/atlas-web/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"]
  },
  resolve: {
    alias: { "@": new URL("./", import.meta.url).pathname.replace(/\/$/, "") }
  }
});
```

- [ ] **Step 5: Write `vitest.setup.ts`**

```typescript
import "@testing-library/jest-dom/vitest";

// Default Clerk mock — tests can override
vi.mock("@clerk/nextjs", async () => ({
  auth: () => ({ userId: "test-user-id", protect: () => {} }),
  currentUser: async () => ({ id: "test-user-id", emailAddresses: [{ emailAddress: "test@atlas.dev" }] }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: () => null,
  UserButton: () => null
}));

vi.mock("@clerk/nextjs/server", async () => ({
  auth: () => ({ userId: "test-user-id" })
}));
```

- [ ] **Step 6: Install + verify**

```bash
pnpm install
pnpm -F atlas-web typecheck
```

Expected: exit 0. The Next.js scaffold may have generated a default `app/page.tsx`; that's fine — it'll be replaced in Task 7.

- [ ] **Step 7: Commit**

```bash
git add apps/atlas-web/ pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(atlas-web): scaffold Next.js 15 app with Tailwind, Clerk, React Flow, workspace deps"
```

If `pnpm-workspace.yaml` does not include `apps/*`, add `- "apps/*"` under `packages:` first.

---

### Task 2: Clerk middleware + sign-in/up routes

**Files:** `middleware.ts`, `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx`, `.env.example`.

- [ ] **Step 1: Write `apps/atlas-web/middleware.ts`**

```typescript
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"]
};
```

- [ ] **Step 2: Write `apps/atlas-web/app/sign-in/[[...sign-in]]/page.tsx`**

```typescript
import { SignIn } from "@clerk/nextjs";
export default function Page() { return <SignIn />; }
```

- [ ] **Step 3: Write `apps/atlas-web/app/sign-up/[[...sign-up]]/page.tsx`**

```typescript
import { SignUp } from "@clerk/nextjs";
export default function Page() { return <SignUp />; }
```

- [ ] **Step 4: Write `.env.example`**

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
CLERK_SECRET_KEY=sk_test_replace_me
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/

# A.1's docker-compose Postgres
DATABASE_URL=postgres://atlas:atlas@localhost:5433/atlas_dev
```

- [ ] **Step 5: Wrap root layout with ClerkProvider**

Edit `apps/atlas-web/app/layout.tsx`:

```typescript
import type { Metadata } from "next";
import { ClerkProvider, SignedIn, UserButton } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Atlas",
  description: "AI Builder — Visualize · Agree · Build"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen bg-white text-slate-900 antialiased">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
            <a href="/" className="font-semibold">Atlas</a>
            <SignedIn>
              <UserButton afterSignOutUrl="/sign-in" />
            </SignedIn>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
```

- [ ] **Step 6: Verify**

```bash
pnpm -F atlas-web typecheck
```

Expected: exit 0. Local `pnpm -F atlas-web dev` should boot at http://localhost:3000 and redirect to `/sign-in` for unauthed users — but no real Clerk keys are needed for typecheck.

- [ ] **Step 7: Commit**

```bash
git add apps/atlas-web/middleware.ts apps/atlas-web/app/sign-in apps/atlas-web/app/sign-up apps/atlas-web/.env.example apps/atlas-web/app/layout.tsx
git commit -m "feat(atlas-web): Clerk middleware + sign-in/up routes + .env.example"
```

---

### Task 3: `AuthProvider` interface + Clerk implementation

**Files:** `lib/auth/provider.ts`, `lib/auth/clerk-provider.ts`, `test/lib/auth/clerk-provider.test.ts`.

- [ ] **Step 1: Write failing test**

`apps/atlas-web/test/lib/auth/clerk-provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => { vi.resetModules(); });

describe("ClerkAuthProvider", () => {
  it("getCurrentUserId returns the auth() userId", async () => {
    vi.doMock("@clerk/nextjs/server", () => ({
      auth: () => ({ userId: "user_abc" })
    }));
    const { ClerkAuthProvider } = await import("@/lib/auth/clerk-provider.js");
    const p = new ClerkAuthProvider();
    expect(await p.getCurrentUserId()).toBe("user_abc");
  });

  it("returns null when no session", async () => {
    vi.doMock("@clerk/nextjs/server", () => ({ auth: () => ({ userId: null }) }));
    const { ClerkAuthProvider } = await import("@/lib/auth/clerk-provider.js");
    const p = new ClerkAuthProvider();
    expect(await p.getCurrentUserId()).toBeNull();
  });

  it("signInUrl wraps the configured sign-in path with returnTo", async () => {
    vi.doMock("@clerk/nextjs/server", () => ({ auth: () => ({ userId: null }) }));
    const { ClerkAuthProvider } = await import("@/lib/auth/clerk-provider.js");
    const p = new ClerkAuthProvider();
    expect(p.signInUrl("/projects/p-1/canvas")).toBe("/sign-in?redirect_url=%2Fprojects%2Fp-1%2Fcanvas");
  });
});
```

- [ ] **Step 2: Run — fail**

```bash
pnpm -F atlas-web test clerk-provider
```

- [ ] **Step 3: Implement `lib/auth/provider.ts`**

```typescript
export interface AuthProvider {
  getCurrentUserId(): Promise<string | null>;
  getCurrentUserEmail(): Promise<string | null>;
  signInUrl(returnTo: string): string;
}
```

- [ ] **Step 4: Implement `lib/auth/clerk-provider.ts`**

```typescript
import { auth, currentUser } from "@clerk/nextjs/server";
import type { AuthProvider } from "./provider.js";

export class ClerkAuthProvider implements AuthProvider {
  async getCurrentUserId(): Promise<string | null> {
    const { userId } = await auth();
    return userId ?? null;
  }
  async getCurrentUserEmail(): Promise<string | null> {
    const u = await currentUser();
    return u?.emailAddresses[0]?.emailAddress ?? null;
  }
  signInUrl(returnTo: string): string {
    return `/sign-in?redirect_url=${encodeURIComponent(returnTo)}`;
  }
}
```

- [ ] **Step 5: Run + commit**

```bash
pnpm -F atlas-web test clerk-provider
git add apps/atlas-web/lib/auth/ apps/atlas-web/test/lib/auth/
git commit -m "feat(atlas-web): AuthProvider interface + ClerkAuthProvider"
```

---

### Task 4: `user_project_preferences` table + `PreferencesRepo` in spec-graph-data

**Files:** new migration + repo + test in `packages/spec-graph-data/`.

- [ ] **Step 1: Add migration**

Find the next-numbered migration in `packages/spec-graph-data/src/schema/migrations/` and create `00NN_user_project_preferences.sql`:

```sql
CREATE TABLE user_project_preferences (
  user_id     text NOT NULL,
  project_id  uuid NOT NULL REFERENCES spec_graphs(project_id) ON DELETE CASCADE,
  persona     text NOT NULL CHECK (persona IN ('ama', 'diego', 'priya')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);
COMMENT ON TABLE user_project_preferences IS 'Per-user, per-project persona override. Absent → use user default from Clerk metadata.';
```

- [ ] **Step 2: Write failing test**

`packages/spec-graph-data/test/repo/preferences-repo.test.ts` (follow A.1's existing test pattern):

```typescript
import { describe, it, expect } from "vitest";
import { PreferencesRepo } from "../../src/repo/preferences-repo.js";
import { withTestDb } from "../helpers/with-test-db.js";

describe("PreferencesRepo", () => {
  it("getOverride returns null when absent, persists after upsert", async () => {
    await withTestDb(async (pool) => {
      const projectId = "11111111-1111-4111-8111-111111111111";
      await pool.query(
        "INSERT INTO spec_graphs (project_id, name, schema_version, graph_data) VALUES ($1, 'demo', '1.0.0', '{}')",
        [projectId]
      );
      const repo = new PreferencesRepo(pool);
      expect(await repo.getOverride("user_a", projectId)).toBeNull();
      await repo.upsertOverride("user_a", projectId, "diego");
      expect(await repo.getOverride("user_a", projectId)).toBe("diego");
    });
  });

  it("upsertOverride updates an existing row", async () => {
    await withTestDb(async (pool) => {
      const projectId = "22222222-2222-4222-8222-222222222222";
      await pool.query(
        "INSERT INTO spec_graphs (project_id, name, schema_version, graph_data) VALUES ($1, 'demo2', '1.0.0', '{}')",
        [projectId]
      );
      const repo = new PreferencesRepo(pool);
      await repo.upsertOverride("user_b", projectId, "ama");
      await repo.upsertOverride("user_b", projectId, "priya");
      expect(await repo.getOverride("user_b", projectId)).toBe("priya");
    });
  });
});
```

- [ ] **Step 3: Implement `packages/spec-graph-data/src/repo/preferences-repo.ts`**

```typescript
import type { Pool } from "pg";

export type PersonaOverride = "ama" | "diego" | "priya";

export class PreferencesRepo {
  constructor(private readonly pool: Pool) {}

  async getOverride(userId: string, projectId: string): Promise<PersonaOverride | null> {
    const r = await this.pool.query<{ persona: PersonaOverride }>(
      "SELECT persona FROM user_project_preferences WHERE user_id = $1 AND project_id = $2",
      [userId, projectId]
    );
    return r.rowCount === 0 ? null : r.rows[0].persona;
  }

  async upsertOverride(userId: string, projectId: string, persona: PersonaOverride): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_project_preferences (user_id, project_id, persona)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, project_id) DO UPDATE SET persona = EXCLUDED.persona, updated_at = now()`,
      [userId, projectId, persona]
    );
  }
}
```

- [ ] **Step 4: Export from `packages/spec-graph-data/src/index.ts`**

```typescript
export { PreferencesRepo, type PersonaOverride } from "./repo/preferences-repo.js";
```

- [ ] **Step 5: Run + commit**

```bash
pnpm -F @atlas/spec-graph-data test preferences-repo
git add packages/spec-graph-data/src/schema/migrations/ packages/spec-graph-data/src/repo/preferences-repo.ts packages/spec-graph-data/src/index.ts packages/spec-graph-data/test/repo/preferences-repo.test.ts
git commit -m "feat(spec-graph-data): user_project_preferences table + PreferencesRepo"
```

---

### Task 5: `PersonaPreferences` impl reading Clerk + override repo

**Files:** `lib/engine/persona-prefs.ts` + test.

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect, vi } from "vitest";
import { ClerkPersonaPreferences } from "@/lib/engine/persona-prefs.js";

describe("ClerkPersonaPreferences", () => {
  it("returns the per-project override when present", async () => {
    const repo = { getOverride: vi.fn(async () => "priya" as const), upsertOverride: vi.fn() };
    const clerkUser = { publicMetadata: { defaultPersona: "diego" } };
    const prefs = new ClerkPersonaPreferences(repo as never, async () => clerkUser as never);
    expect(await prefs.getPersona("user_a", "p-1")).toBe("priya");
    expect(repo.getOverride).toHaveBeenCalledWith("user_a", "p-1");
  });

  it("falls back to Clerk metadata defaultPersona when no override", async () => {
    const repo = { getOverride: vi.fn(async () => null), upsertOverride: vi.fn() };
    const clerkUser = { publicMetadata: { defaultPersona: "diego" } };
    const prefs = new ClerkPersonaPreferences(repo as never, async () => clerkUser as never);
    expect(await prefs.getPersona("user_a", "p-1")).toBe("diego");
  });

  it("falls back to 'ama' (least-privileged) when nothing is set", async () => {
    const repo = { getOverride: vi.fn(async () => null), upsertOverride: vi.fn() };
    const clerkUser = { publicMetadata: {} };
    const prefs = new ClerkPersonaPreferences(repo as never, async () => clerkUser as never);
    expect(await prefs.getPersona("user_a", "p-1")).toBe("ama");
  });

  it("rejects an invalid metadata value", async () => {
    const repo = { getOverride: vi.fn(async () => null), upsertOverride: vi.fn() };
    const clerkUser = { publicMetadata: { defaultPersona: "admin" } };
    const prefs = new ClerkPersonaPreferences(repo as never, async () => clerkUser as never);
    expect(await prefs.getPersona("user_a", "p-1")).toBe("ama");
  });
});
```

- [ ] **Step 2: Implement**

```typescript
import type { PersonaPreferences, PersonaTier } from "@atlas/ritual-engine";
import type { PreferencesRepo } from "@atlas/spec-graph-data";

const VALID = new Set<PersonaTier>(["ama", "diego", "priya"]);

export class ClerkPersonaPreferences implements PersonaPreferences {
  constructor(
    private readonly repo: PreferencesRepo,
    private readonly fetchUser: (userId: string) => Promise<{ publicMetadata?: { defaultPersona?: unknown } } | null>
  ) {}

  async getPersona(userId: string, projectId: string): Promise<PersonaTier> {
    const override = await this.repo.getOverride(userId, projectId);
    if (override && VALID.has(override)) return override;
    const user = await this.fetchUser(userId);
    const fromClerk = user?.publicMetadata?.defaultPersona;
    if (typeof fromClerk === "string" && VALID.has(fromClerk as PersonaTier)) {
      return fromClerk as PersonaTier;
    }
    return "ama";
  }
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm -F atlas-web test persona-prefs
git add apps/atlas-web/lib/engine/persona-prefs.ts apps/atlas-web/test/lib/engine/persona-prefs.test.ts
git commit -m "feat(atlas-web): ClerkPersonaPreferences (override → metadata → ama fallback)"
```

---

### Task 6: Per-request `RitualEngine` factory + `EventSink` wired to spec-graph-data

**Files:** `lib/engine/factory.ts`, `lib/engine/event-sink.ts`, tests.

- [ ] **Step 1: Write failing test for the EventSink**

`apps/atlas-web/test/lib/engine/event-sink.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { SpecEventsSink } from "@/lib/engine/event-sink.js";

describe("SpecEventsSink", () => {
  it("forwards every RitualEvent to spec_events repo via append", async () => {
    const append = vi.fn(async () => {});
    const sink = new SpecEventsSink({ append } as never, "p-1");
    await sink.emit({
      type: "ritual.started", ritualId: "r-1", ts: "t",
      payload: { intent: "x", editClass: "structural", projectId: "p-1", userId: "u-1" }
    });
    expect(append).toHaveBeenCalledOnce();
    const call = append.mock.calls[0];
    expect(call[0]).toBe("p-1");
    expect(call[1]).toMatchObject({ event_type: "ritual.started", ritual_id: "r-1" });
  });
});
```

- [ ] **Step 2: Implement `lib/engine/event-sink.ts`**

```typescript
import type { EventSink, RitualEvent } from "@atlas/ritual-engine";

export interface SpecEventsRepoLike {
  append(projectId: string, event: { event_type: string; ritual_id: string; payload: unknown; ts: string }): Promise<void>;
}

export class SpecEventsSink implements EventSink {
  constructor(private readonly repo: SpecEventsRepoLike, private readonly projectId: string) {}
  async emit(event: RitualEvent): Promise<void> {
    await this.repo.append(this.projectId, {
      event_type: event.type,
      ritual_id: event.ritualId,
      payload: ("payload" in event ? event.payload : null) as unknown,
      ts: event.ts
    });
  }
}
```

- [ ] **Step 3: Implement `lib/engine/factory.ts`** (cached per request)

```typescript
import { cache } from "react";
import { Conductor } from "@atlas/conductor";
import { RitualEngine } from "@atlas/ritual-engine";
import { ClerkPersonaPreferences } from "./persona-prefs.js";
import { SpecEventsSink } from "./event-sink.js";

/** Lazy + per-request cached. Real DB client + Conductor wiring happens here. */
export const getRitualEngine = cache(async (projectId: string): Promise<RitualEngine> => {
  const { Pool } = await import("pg");
  const { PreferencesRepo, SpecEventsRepo, SpecGraphRepo } = await import("@atlas/spec-graph-data");
  const { currentUser } = await import("@clerk/nextjs/server");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prefs = new ClerkPersonaPreferences(
    new PreferencesRepo(pool),
    async (_userId) => (await currentUser()) as never
  );

  // Conductor — for E.2 we instantiate with empty roles; D.3-D.5 wire real ones in their own plans.
  const conductor = new Conductor({
    classifier: { classify: async () => ({ roleId: "architect", confidence: 0.9 }) },
    roles: new Map(),
    checkpointSink: { emit: async () => {} },
    sliceBuilder: () => ({ bytes: "{}", hash: "sha256:" + "0".repeat(64) })
  });

  return new RitualEngine({
    conductor,
    eventSink: new SpecEventsSink(new SpecEventsRepo(pool), projectId),
    personaPreferences: prefs
  });
});
```

- [ ] **Step 4: Test the factory (smoke; no DB)**

`apps/atlas-web/test/lib/engine/factory.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("getRitualEngine", () => {
  it("imports without throwing under mocked deps", async () => {
    vi.doMock("pg", () => ({ Pool: class { query() {} } }));
    vi.doMock("@atlas/spec-graph-data", () => ({
      PreferencesRepo: class { async getOverride() { return null; } },
      SpecEventsRepo: class { async append() {} },
      SpecGraphRepo: class {}
    }));
    vi.doMock("@clerk/nextjs/server", () => ({
      currentUser: async () => ({ publicMetadata: { defaultPersona: "diego" } })
    }));
    const { getRitualEngine } = await import("@/lib/engine/factory.js");
    const engine = await getRitualEngine("p-1");
    expect(engine).toBeDefined();
  });
});
```

- [ ] **Step 5: Run + commit**

```bash
pnpm -F atlas-web test event-sink factory
git add apps/atlas-web/lib/engine/ apps/atlas-web/test/lib/engine/
git commit -m "feat(atlas-web): SpecEventsSink + per-request RitualEngine factory (cached)"
```

---

### Task 7: Landing + new-project pages

**Files:** `app/page.tsx`, `app/projects/new/page.tsx`.

- [ ] **Step 1: Replace `app/page.tsx`** with a Server Component that lists the user's projects.

```typescript
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";

export default async function LandingPage() {
  const { userId } = await auth();
  if (!userId) return null; // middleware redirects

  // For E.2 we hard-code an empty list; A.1's SpecGraphRepo provides .listForUser in a future task.
  const projects: Array<{ id: string; name: string }> = [];

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Your projects</h1>
      <p className="mt-2 text-sm text-slate-600">Visualize → Agree → Build</p>
      <div className="mt-6">
        <Link href="/projects/new" className="rounded-md bg-slate-900 px-4 py-2 text-white">+ New project</Link>
      </div>
      {projects.length === 0 ? (
        <p className="mt-8 text-slate-500">No projects yet. Click "New project" to start.</p>
      ) : (
        <ul className="mt-8 space-y-2">
          {projects.map((p) => (
            <li key={p.id}><Link href={`/projects/${p.id}`} className="underline">{p.name}</Link></li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Write `app/projects/new/page.tsx`** — minimal form that calls a Server Action to create a project (the action is a stub for E.2; full provisioning lands later).

```typescript
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

async function createProject(formData: FormData): Promise<void> {
  "use server";
  const name = String(formData.get("name") ?? "untitled");
  const projectId = randomUUID();
  // E.2 stub — real provisioning calls SpecGraphRepo.create() in a follow-up task.
  // For now, redirect to the canvas page; the canvas Server Component handles "no graph yet".
  redirect(`/projects/${projectId}/canvas?bootstrap=1&name=${encodeURIComponent(name)}`);
}

export default function NewProjectPage() {
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">New project</h1>
      <form action={createProject} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Project name</span>
          <input name="name" required className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 text-white">Create</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/app/page.tsx apps/atlas-web/app/projects/new/page.tsx
git commit -m "feat(atlas-web): landing + new-project page (Server Action stub)"
```

---

### Task 8: Per-project layout + Canvas/Code tab nav + persona toggle

**Files:** `app/projects/[projectId]/layout.tsx`, `app/projects/[projectId]/page.tsx` (redirect), `components/PersonaToggle.tsx`, test.

- [ ] **Step 1: Write failing test for PersonaToggle**

`apps/atlas-web/test/components/PersonaToggle.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonaToggle } from "@/components/PersonaToggle.js";

describe("PersonaToggle", () => {
  it("renders three buttons reflecting the current persona", () => {
    const onChange = vi.fn();
    render(<PersonaToggle current="diego" onChange={onChange} />);
    expect(screen.getByRole("button", { name: /Ama/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Diego/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Priya/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("calls onChange when clicking a different persona", async () => {
    const onChange = vi.fn();
    render(<PersonaToggle current="ama" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Priya/i }));
    expect(onChange).toHaveBeenCalledWith("priya");
  });
});
```

- [ ] **Step 2: Implement `components/PersonaToggle.tsx`**

```typescript
"use client";

import type { PersonaTier } from "@atlas/ritual-engine";

interface Props {
  current: PersonaTier;
  onChange: (next: PersonaTier) => void;
}

const ALL: PersonaTier[] = ["ama", "diego", "priya"];

export function PersonaToggle({ current, onChange }: Props) {
  return (
    <div role="group" aria-label="Persona tier" className="inline-flex rounded-md border border-slate-300 overflow-hidden">
      {ALL.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={p === current}
          onClick={() => onChange(p)}
          className={`px-3 py-1 text-sm capitalize ${p === current ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write `app/projects/[projectId]/layout.tsx`**

```typescript
import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { Pool } from "pg";
import { PreferencesRepo } from "@atlas/spec-graph-data";

export default async function ProjectLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const { userId } = await auth();
  if (!userId) return null;

  // Resolve persona for this project (override → metadata → ama)
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prefs = new PreferencesRepo(pool);
  const override = await prefs.getOverride(userId, projectId);
  const user = await currentUser();
  const persona = override ?? (user?.publicMetadata?.defaultPersona as string | undefined) ?? "ama";

  return (
    <div className="flex flex-col">
      <nav className="flex items-center gap-4 border-b border-slate-200 px-4 py-2">
        <Link href={`/projects/${projectId}/canvas`} className="text-sm hover:underline">Canvas</Link>
        <Link href={`/projects/${projectId}/code`} className="text-sm hover:underline">Code</Link>
        <span className="ml-auto text-xs text-slate-500">Persona: {persona}</span>
      </nav>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Write `app/projects/[projectId]/page.tsx`** (redirect to /canvas)

```typescript
import { redirect } from "next/navigation";

export default async function ProjectIndex({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  redirect(`/projects/${projectId}/canvas`);
}
```

- [ ] **Step 5: Run tests + commit**

```bash
pnpm -F atlas-web test PersonaToggle
git add apps/atlas-web/app/projects/ apps/atlas-web/components/PersonaToggle.tsx apps/atlas-web/test/components/PersonaToggle.test.tsx
git commit -m "feat(atlas-web): per-project layout + persona toggle component"
```

---

### Task 9: Canvas page + `<CanvasClient>` React Flow component

**Files:** `app/projects/[projectId]/canvas/page.tsx`, `components/CanvasClient.tsx`, test.

- [ ] **Step 1: Write failing test for CanvasClient**

`apps/atlas-web/test/components/CanvasClient.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CanvasClient } from "@/components/CanvasClient.js";

vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes }: { nodes: unknown[] }) => (
    <div data-testid="rf-mock">{nodes.length} nodes</div>
  ),
  Background: () => null,
  Controls: () => null,
  applyNodeChanges: (_c: unknown, n: unknown) => n,
  applyEdgeChanges: (_c: unknown, e: unknown) => e
}));

describe("CanvasClient", () => {
  it("renders one React-Flow node per Spec Graph node", () => {
    const graph = {
      nodes: {
        "page:home": { kind: "page", id: "page:home", path: "/", title: "Home", renderMode: "ssr", routeRef: "GET /" },
        "page:about": { kind: "page", id: "page:about", path: "/about", title: "About", renderMode: "ssr", routeRef: "GET /about" }
      },
      edges: []
    };
    render(<CanvasClient graph={graph as never} projectId="p-1" />);
    expect(screen.getByTestId("rf-mock")).toHaveTextContent("2 nodes");
  });
});
```

- [ ] **Step 2: Implement `components/CanvasClient.tsx`**

```typescript
"use client";

import { useState, useCallback } from "react";
import { ReactFlow, Background, Controls, applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeChange, type EdgeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export interface CanvasClientProps {
  graph: { nodes: Record<string, { kind: string; id: string } & Record<string, unknown>>; edges: Array<{ from: string; to: string; type: string }> };
  projectId: string;
}

export function CanvasClient({ graph }: CanvasClientProps) {
  const [nodes, setNodes] = useState<Node[]>(() =>
    Object.values(graph.nodes).map((n, i) => ({
      id: n.id,
      type: "default",
      data: { label: `${n.kind}: ${n.id}` },
      position: { x: (i % 5) * 220, y: Math.floor(i / 5) * 140 }
    }))
  );
  const [edges, setEdges] = useState<Edge[]>(() =>
    graph.edges.map((e, i) => ({ id: `e-${i}`, source: e.from, target: e.to, label: e.type }))
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((n) => applyNodeChanges(changes, n)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((e) => applyEdgeChanges(changes, e)), []);

  return (
    <div className="h-[calc(100vh-7rem)]">
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 3: Write `app/projects/[projectId]/canvas/page.tsx`**

```typescript
import { CanvasClient } from "@/components/CanvasClient.js";

export default async function CanvasPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  // E.2 ships an empty-graph fallback. A future task wires SpecGraphRepo.read(projectId).
  const graph = { nodes: {}, edges: [] };

  return (
    <main className="flex h-full">
      <section className="flex-1">
        <CanvasClient graph={graph} projectId={projectId} />
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run + commit**

```bash
pnpm -F atlas-web test CanvasClient
git add apps/atlas-web/app/projects/[projectId]/canvas/ apps/atlas-web/components/CanvasClient.tsx apps/atlas-web/test/components/CanvasClient.test.tsx
git commit -m "feat(atlas-web): Canvas page + React Flow CanvasClient component"
```

---

### Task 10: `startRitual` Server Action + ChatPanel that calls it

**Files:** `lib/actions/startRitual.ts`, `components/ChatPanel.tsx`, tests.

- [ ] **Step 1: Write failing test for the action**

`apps/atlas-web/test/actions/startRitual.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("startRitual action", () => {
  it("calls engine.start with the right inputs", async () => {
    const start = vi.fn(async () => "r-123");
    vi.doMock("@/lib/engine/factory.js", () => ({
      getRitualEngine: async () => ({ start })
    }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: () => ({ userId: "u-1" }) }));
    const { startRitual } = await import("@/lib/actions/startRitual.js");
    const r = await startRitual({ projectId: "p-1", userTurn: "add forgot-password", editClass: "structural" });
    expect(r).toBe("r-123");
    expect(start).toHaveBeenCalledOnce();
    const arg = start.mock.calls[0][0];
    expect(arg).toMatchObject({ userTurn: "add forgot-password", editClass: "structural", projectId: "p-1", userId: "u-1" });
  });

  it("rejects unauthed callers", async () => {
    vi.doMock("@/lib/engine/factory.js", () => ({ getRitualEngine: async () => ({ start: vi.fn() }) }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: () => ({ userId: null }) }));
    const { startRitual } = await import("@/lib/actions/startRitual.js");
    await expect(startRitual({ projectId: "p-1", userTurn: "x", editClass: "cosmetic" })).rejects.toThrow(/unauth/i);
  });
});
```

- [ ] **Step 2: Implement `lib/actions/startRitual.ts`**

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";
import { getRitualEngine } from "@/lib/engine/factory.js";
import type { EditClass } from "@atlas/ritual-engine";

export interface StartRitualInput {
  projectId: string;
  userTurn: string;
  editClass: EditClass;
}

export async function startRitual(input: StartRitualInput): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getRitualEngine(input.projectId);
  return engine.start({
    userTurn: input.userTurn,
    editClass: input.editClass,
    projectId: input.projectId,
    userId
  });
}
```

- [ ] **Step 3: Write failing test for ChatPanel**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "@/components/ChatPanel.js";

describe("ChatPanel", () => {
  it("submits user turn via injected onSend", async () => {
    const onSend = vi.fn(async () => "r-1");
    render(<ChatPanel projectId="p-1" onSend={onSend} />);
    await userEvent.type(screen.getByPlaceholderText(/Describe your change/i), "add login");
    await userEvent.click(screen.getByRole("button", { name: /Send/i }));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0][0]).toBe("add login");
  });
});
```

- [ ] **Step 4: Implement `components/ChatPanel.tsx`**

```typescript
"use client";

import { useState } from "react";

export interface ChatPanelProps {
  projectId: string;
  onSend: (userTurn: string) => Promise<string>;
}

export function ChatPanel({ onSend }: ChatPanelProps) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<Array<{ role: "user"; text: string }>>([]);

  async function send() {
    if (!text.trim() || pending) return;
    setPending(true);
    setHistory((h) => [...h, { role: "user", text }]);
    try {
      await onSend(text);
      setText("");
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="flex h-full w-80 flex-col border-l border-slate-200">
      <div className="flex-1 overflow-y-auto p-3">
        {history.map((m, i) => (
          <div key={i} className="mb-2 text-sm"><strong>You:</strong> {m.text}</div>
        ))}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="border-t border-slate-200 p-2"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe your change…"
          className="block w-full resize-none rounded-md border border-slate-300 p-2 text-sm"
          rows={3}
          disabled={pending}
        />
        <button type="submit" disabled={pending || !text.trim()} className="mt-2 rounded-md bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50">Send</button>
      </form>
    </aside>
  );
}
```

- [ ] **Step 5: Wire ChatPanel into the canvas page**

Update `app/projects/[projectId]/canvas/page.tsx`:

```typescript
import { CanvasClient } from "@/components/CanvasClient.js";
import { ChatPanel } from "@/components/ChatPanel.js";
import { startRitual } from "@/lib/actions/startRitual.js";

export default async function CanvasPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const graph = { nodes: {}, edges: [] };

  return (
    <main className="flex h-full">
      <section className="flex-1">
        <CanvasClient graph={graph} projectId={projectId} />
      </section>
      <ChatPanel
        projectId={projectId}
        onSend={async (userTurn) => startRitual({ projectId, userTurn, editClass: "structural" })}
      />
    </main>
  );
}
```

- [ ] **Step 6: Run + commit**

```bash
pnpm -F atlas-web test startRitual ChatPanel
git add apps/atlas-web/lib/actions/startRitual.ts apps/atlas-web/components/ChatPanel.tsx apps/atlas-web/test/actions/startRitual.test.ts apps/atlas-web/test/components/ChatPanel.test.tsx apps/atlas-web/app/projects/[projectId]/canvas/page.tsx
git commit -m "feat(atlas-web): startRitual Server Action + ChatPanel + Canvas wiring"
```

---

### Task 11: `approveRitual` action + `ApprovalPanel` component

**Files:** `lib/actions/approveRitual.ts`, `components/ApprovalPanel.tsx`, tests.

- [ ] **Step 1: Write failing test for the action**

```typescript
import { describe, it, expect, vi } from "vitest";

describe("approveRitual action", () => {
  it("forwards approved decision to engine.approve", async () => {
    const approve = vi.fn(async () => {});
    vi.doMock("@/lib/engine/factory.js", () => ({ getRitualEngine: async () => ({ approve }) }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: () => ({ userId: "u-1" }) }));
    const { approveRitual } = await import("@/lib/actions/approveRitual.js");
    await approveRitual({ projectId: "p-1", ritualId: "r-1", decision: { kind: "approved", persona: "diego" } });
    expect(approve).toHaveBeenCalledWith("r-1", expect.objectContaining({ kind: "approved", approvedBy: "u-1", persona: "diego" }));
  });

  it("forwards changes_requested with notes", async () => {
    const approve = vi.fn(async () => {});
    vi.doMock("@/lib/engine/factory.js", () => ({ getRitualEngine: async () => ({ approve }) }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: () => ({ userId: "u-1" }) }));
    const { approveRitual } = await import("@/lib/actions/approveRitual.js");
    await approveRitual({ projectId: "p-1", ritualId: "r-1", decision: { kind: "changes_requested", notes: "fix a11y" } });
    expect(approve).toHaveBeenCalledWith("r-1", expect.objectContaining({ kind: "changes_requested", requestedBy: "u-1", notes: "fix a11y" }));
  });
});
```

- [ ] **Step 2: Implement `lib/actions/approveRitual.ts`**

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";
import { getRitualEngine } from "@/lib/engine/factory.js";
import type { PersonaTier } from "@atlas/ritual-engine";

export type ApprovalInput =
  | { kind: "approved"; persona: PersonaTier }
  | { kind: "changes_requested"; notes: string };

export async function approveRitual({ projectId, ritualId, decision }: { projectId: string; ritualId: string; decision: ApprovalInput }): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getRitualEngine(projectId);
  if (decision.kind === "approved") {
    await engine.approve(ritualId, { kind: "approved", approvedBy: userId, persona: decision.persona });
  } else {
    await engine.approve(ritualId, { kind: "changes_requested", requestedBy: userId, notes: decision.notes });
  }
}
```

- [ ] **Step 3: Write failing test for `ApprovalPanel`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalPanel } from "@/components/ApprovalPanel.js";

describe("ApprovalPanel", () => {
  it("Ama sees Yes / No / Ask", () => {
    render(<ApprovalPanel persona="ama" artifact={{ scope: "new-feature" }} onApprove={vi.fn()} onChangesRequested={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ask/i })).toBeInTheDocument();
  });

  it("Diego sees Approve / Request changes + raw artifact preview", () => {
    render(<ApprovalPanel persona="diego" artifact={{ scope: "new-feature" }} onApprove={vi.fn()} onChangesRequested={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Request changes/i })).toBeInTheDocument();
  });

  it("Yes triggers onApprove", async () => {
    const onApprove = vi.fn();
    render(<ApprovalPanel persona="ama" artifact={{}} onApprove={onApprove} onChangesRequested={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it("Request changes shows notes input + submits with text", async () => {
    const onChanges = vi.fn();
    render(<ApprovalPanel persona="diego" artifact={{}} onApprove={vi.fn()} onChangesRequested={onChanges} />);
    await userEvent.click(screen.getByRole("button", { name: /Request changes/i }));
    await userEvent.type(screen.getByPlaceholderText(/What needs to change/i), "Add RTL support");
    await userEvent.click(screen.getByRole("button", { name: /Submit/i }));
    expect(onChanges).toHaveBeenCalledWith("Add RTL support");
  });
});
```

- [ ] **Step 4: Implement `components/ApprovalPanel.tsx`**

```typescript
"use client";

import { useState } from "react";
import type { PersonaTier } from "@atlas/ritual-engine";

export interface ApprovalPanelProps {
  persona: PersonaTier;
  artifact: unknown;
  onApprove: () => void;
  onChangesRequested: (notes: string) => void;
}

export function ApprovalPanel({ persona, artifact, onApprove, onChangesRequested }: ApprovalPanelProps) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState("");

  const yesLabel = persona === "ama" ? "Yes" : "Approve";
  const noLabel = persona === "ama" ? "No" : "Request changes";

  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold">Review the proposed change</h3>
      {persona !== "ama" && (
        <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-slate-50 p-2 text-xs">{JSON.stringify(artifact, null, 2)}</pre>
      )}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onApprove} className="rounded-md bg-slate-900 px-3 py-1 text-sm text-white">{yesLabel}</button>
        <button type="button" onClick={() => setShowNotes((v) => !v)} className="rounded-md border border-slate-300 px-3 py-1 text-sm">{noLabel}</button>
        {persona === "ama" && (
          <button type="button" className="rounded-md border border-slate-300 px-3 py-1 text-sm">Ask a reviewer</button>
        )}
      </div>
      {showNotes && (
        <div className="mt-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What needs to change?"
            className="block w-full rounded-md border border-slate-300 p-2 text-sm"
            rows={3}
          />
          <button
            type="button"
            disabled={!notes.trim()}
            onClick={() => onChangesRequested(notes)}
            className="mt-2 rounded-md bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >Submit</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run + commit**

```bash
pnpm -F atlas-web test approveRitual ApprovalPanel
git add apps/atlas-web/lib/actions/approveRitual.ts apps/atlas-web/components/ApprovalPanel.tsx apps/atlas-web/test/actions/approveRitual.test.ts apps/atlas-web/test/components/ApprovalPanel.test.tsx
git commit -m "feat(atlas-web): approveRitual action + ApprovalPanel (persona-tiered)"
```

---

### Task 12: `acceptRiskAction` + `RiskAcceptModal` + `EscalationCallout`

**Files:** `lib/actions/acceptRiskAction.ts`, `components/RiskAcceptModal.tsx`, `components/EscalationCallout.tsx`, tests.

- [ ] **Step 1: Failing test for the action — happy path + persona-gate path**

```typescript
import { describe, it, expect, vi } from "vitest";

describe("acceptRiskAction", () => {
  it("forwards a Diego L4 risk-accept", async () => {
    const acceptRisk = vi.fn(async () => {});
    vi.doMock("@/lib/engine/factory.js", () => ({ getRitualEngine: async () => ({ acceptRisk }) }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: () => ({ userId: "u-diego" }) }));
    const { acceptRiskAction } = await import("@/lib/actions/acceptRiskAction.js");
    await acceptRiskAction({
      projectId: "p-1", ritualId: "r-1",
      gate: "L4-security", persona: "diego",
      failureSummary: "wildcard CORS", rationale: "Sunset by 2026-06-01; tracked in JIRA-123", scope: "session"
    });
    expect(acceptRisk).toHaveBeenCalledOnce();
  });

  it("propagates PersonaGateError back to the caller", async () => {
    const { PersonaGateError } = await import("@atlas/ritual-engine");
    const acceptRisk = vi.fn(async () => { throw new PersonaGateError("L4-security", "ama", "diego"); });
    vi.doMock("@/lib/engine/factory.js", () => ({ getRitualEngine: async () => ({ acceptRisk }) }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: () => ({ userId: "u-ama" }) }));
    const { acceptRiskAction } = await import("@/lib/actions/acceptRiskAction.js");
    await expect(acceptRiskAction({
      projectId: "p-1", ritualId: "r-1",
      gate: "L4-security", persona: "ama",
      failureSummary: "f", rationale: "twenty character rationale here ok", scope: "session"
    })).rejects.toThrow(/persona/i);
  });
});
```

- [ ] **Step 2: Implement `lib/actions/acceptRiskAction.ts`**

```typescript
"use server";

import { auth } from "@clerk/nextjs/server";
import { getRitualEngine } from "@/lib/engine/factory.js";
import type { PersonaTier } from "@atlas/ritual-engine";

export interface AcceptRiskInput {
  projectId: string;
  ritualId: string;
  gate: "L4-security" | "L5-compliance" | "L6-a11y-advisory" | "L7-visual-advisory";
  persona: PersonaTier;
  failureSummary: string;
  rationale: string;
  scope: "single-commit" | "session" | "permanent-for-project";
}

export async function acceptRiskAction(input: AcceptRiskInput): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getRitualEngine(input.projectId);
  await engine.acceptRisk(input.ritualId, {
    gate: input.gate,
    failureSummary: input.failureSummary,
    acceptedBy: { personaTier: input.persona, userId, timestamp: new Date().toISOString() },
    rationale: input.rationale,
    scope: input.scope
  });
}
```

- [ ] **Step 3: Failing test for `RiskAcceptModal`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RiskAcceptModal } from "@/components/RiskAcceptModal.js";

describe("RiskAcceptModal", () => {
  it("submit disabled until rationale ≥ 20 chars", async () => {
    render(<RiskAcceptModal open onSubmit={vi.fn()} onClose={vi.fn()} gate="L4-security" persona="diego" failureSummary="x" />);
    const submit = screen.getByRole("button", { name: /Accept risk/i });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/rationale/i), "short");
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText(/rationale/i), " padded out to past twenty chars");
    expect(submit).toBeEnabled();
  });

  it("submitting calls onSubmit with the form values", async () => {
    const onSubmit = vi.fn();
    render(<RiskAcceptModal open onSubmit={onSubmit} onClose={vi.fn()} gate="L4-security" persona="diego" failureSummary="wildcard CORS" />);
    await userEvent.type(screen.getByPlaceholderText(/rationale/i), "Twenty-something chars rationale");
    await userEvent.click(screen.getByRole("button", { name: /Accept risk/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      rationale: "Twenty-something chars rationale", scope: "session"
    }));
  });
});
```

- [ ] **Step 4: Implement `components/RiskAcceptModal.tsx`**

```typescript
"use client";

import { useState } from "react";
import type { PersonaTier } from "@atlas/ritual-engine";

export interface RiskAcceptSubmit {
  rationale: string;
  scope: "single-commit" | "session" | "permanent-for-project";
}

export interface RiskAcceptModalProps {
  open: boolean;
  gate: "L4-security" | "L5-compliance" | "L6-a11y-advisory" | "L7-visual-advisory";
  persona: PersonaTier;
  failureSummary: string;
  onSubmit: (s: RiskAcceptSubmit) => void;
  onClose: () => void;
}

export function RiskAcceptModal({ open, gate, persona, failureSummary, onSubmit, onClose }: RiskAcceptModalProps) {
  const [rationale, setRationale] = useState("");
  const [scope, setScope] = useState<RiskAcceptSubmit["scope"]>("session");
  if (!open) return null;
  const valid = rationale.length >= 20;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="w-full max-w-md rounded-md bg-white p-4 shadow-lg">
        <h3 className="text-lg font-semibold">Accept risk for {gate}</h3>
        <p className="mt-1 text-xs text-slate-500">Persona: {persona}</p>
        <p className="mt-2 text-sm">Failure: {failureSummary}</p>
        <textarea
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Rationale (≥20 characters)"
          className="mt-3 block w-full rounded-md border border-slate-300 p-2 text-sm"
          rows={4}
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as RiskAcceptSubmit["scope"])}
          className="mt-2 block w-full rounded-md border border-slate-300 p-2 text-sm"
        >
          <option value="single-commit">Single commit</option>
          <option value="session">Session</option>
          <option value="permanent-for-project">Permanent for project</option>
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1 text-sm">Cancel</button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => onSubmit({ rationale, scope })}
            className="rounded-md bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >Accept risk</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement `components/EscalationCallout.tsx`** (rendered when persona-blocked)

```typescript
"use client";

interface Props {
  gate: string;
  onAskReviewer: () => void;
}

export function EscalationCallout({ gate, onAskReviewer }: Props) {
  return (
    <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
      <p>You're not authorised to risk-accept the <strong>{gate}</strong> gate. Ask a reviewer (Priya tier) to take a look.</p>
      <button type="button" onClick={onAskReviewer} className="mt-2 rounded-md bg-amber-600 px-3 py-1 text-white">Ask a reviewer</button>
    </div>
  );
}
```

- [ ] **Step 6: Run + commit**

```bash
pnpm -F atlas-web test acceptRiskAction RiskAcceptModal
git add apps/atlas-web/lib/actions/acceptRiskAction.ts apps/atlas-web/components/RiskAcceptModal.tsx apps/atlas-web/components/EscalationCallout.tsx apps/atlas-web/test/actions/acceptRiskAction.test.ts apps/atlas-web/test/components/RiskAcceptModal.test.tsx
git commit -m "feat(atlas-web): acceptRiskAction + RiskAcceptModal (≥20-char gate) + EscalationCallout"
```

---

### Task 13: `escalateRitual` action + `setPersonaOverride` action

**Files:** `lib/actions/escalateRitual.ts`, `lib/actions/setPersonaOverride.ts`, tests.

- [ ] **Step 1: `escalateRitual` test + impl**

`apps/atlas-web/test/actions/escalateRitual.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("escalateRitual", () => {
  it("calls engine.escalate with reason + userId", async () => {
    const escalate = vi.fn(async () => {});
    vi.doMock("@/lib/engine/factory.js", () => ({ getRitualEngine: async () => ({ escalate }) }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: () => ({ userId: "u-1" }) }));
    const { escalateRitual } = await import("@/lib/actions/escalateRitual.js");
    await escalateRitual({ projectId: "p-1", ritualId: "r-1", reason: "needs Priya review" });
    expect(escalate).toHaveBeenCalledWith("r-1", "needs Priya review", "u-1");
  });
});
```

`apps/atlas-web/lib/actions/escalateRitual.ts`:

```typescript
"use server";
import { auth } from "@clerk/nextjs/server";
import { getRitualEngine } from "@/lib/engine/factory.js";

export async function escalateRitual({ projectId, ritualId, reason }: { projectId: string; ritualId: string; reason: string }): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const engine = await getRitualEngine(projectId);
  await engine.escalate(ritualId, reason, userId);
}
```

- [ ] **Step 2: `setPersonaOverride` test + impl**

`apps/atlas-web/test/actions/setPersonaOverride.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("setPersonaOverride", () => {
  it("upserts override via PreferencesRepo", async () => {
    const upsert = vi.fn(async () => {});
    vi.doMock("@atlas/spec-graph-data", () => ({
      PreferencesRepo: class { upsertOverride = upsert; }
    }));
    vi.doMock("pg", () => ({ Pool: class { query() {} } }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth: () => ({ userId: "u-1" }) }));
    const { setPersonaOverride } = await import("@/lib/actions/setPersonaOverride.js");
    await setPersonaOverride({ projectId: "p-1", persona: "diego" });
    expect(upsert).toHaveBeenCalledWith("u-1", "p-1", "diego");
  });
});
```

`apps/atlas-web/lib/actions/setPersonaOverride.ts`:

```typescript
"use server";
import { auth } from "@clerk/nextjs/server";
import type { PersonaTier } from "@atlas/ritual-engine";

export async function setPersonaOverride({ projectId, persona }: { projectId: string; persona: PersonaTier }): Promise<void> {
  const { userId } = await auth();
  if (!userId) throw new Error("unauthorized");
  const { Pool } = await import("pg");
  const { PreferencesRepo } = await import("@atlas/spec-graph-data");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const repo = new PreferencesRepo(pool);
  await repo.upsertOverride(userId, projectId, persona);
}
```

- [ ] **Step 3: Run + commit**

```bash
pnpm -F atlas-web test escalateRitual setPersonaOverride
git add apps/atlas-web/lib/actions/escalateRitual.ts apps/atlas-web/lib/actions/setPersonaOverride.ts apps/atlas-web/test/actions/escalateRitual.test.ts apps/atlas-web/test/actions/setPersonaOverride.test.ts
git commit -m "feat(atlas-web): escalateRitual + setPersonaOverride Server Actions"
```

---

### Task 14: SSE events endpoint for the chat panel

**Files:** `app/api/projects/[projectId]/events/route.ts`.

The endpoint tails `spec_events` for the project and pushes new rows as SSE messages. E.2 ships the route shell + a poll-based fallback (real Postgres LISTEN/NOTIFY wiring is a follow-up; the API contract is what the chat panel consumes).

- [ ] **Step 1: Write the route**

```typescript
import { auth } from "@clerk/nextjs/server";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { userId } = await auth();
  if (!userId) return new Response("unauthorized", { status: 401 });

  const { projectId } = await params;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      // E.2 stub: heartbeat every 5s; full LISTEN/NOTIFY wiring is a follow-up.
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      send({ type: "connected", projectId });
      const interval = setInterval(() => send({ type: "heartbeat", ts: new Date().toISOString() }), 5_000);
      // No close handler — Next.js 15 manages streaming lifecycles; CI tests do not exercise this route.
      controller.error = () => clearInterval(interval);
    }
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" }
  });
}
```

- [ ] **Step 2: Commit** (no automated test — SSE testing requires browser/EventSource; covered in E.5 Playwright)

```bash
git add apps/atlas-web/app/api/projects/[projectId]/events/route.ts
git commit -m "feat(atlas-web): SSE events route stub (heartbeat; full wiring deferred)"
```

---

### Task 15: Code view stub at `/projects/[projectId]/code`

**Files:** `app/projects/[projectId]/code/page.tsx`.

A minimal placeholder so navigation works; Monaco lands in E.3.

- [ ] **Step 1: Write the page**

```typescript
export default async function CodePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <main className="p-6">
      <h2 className="text-lg font-semibold">Code view</h2>
      <p className="mt-2 text-sm text-slate-600">Project <code>{projectId}</code></p>
      <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
        Monaco editor + file tree + PR pane land with Plan E.3.
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/atlas-web/app/projects/[projectId]/code/page.tsx
git commit -m "feat(atlas-web): Code view placeholder (Monaco lands in E.3)"
```

---

### Task 16: Loading + error boundaries per route

**Files:** `app/projects/[projectId]/loading.tsx`, `app/projects/[projectId]/error.tsx`.

- [ ] **Step 1: Loading**

```typescript
export default function Loading() {
  return <div className="p-6 text-sm text-slate-500">Loading project…</div>;
}
```

- [ ] **Step 2: Error**

```typescript
"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-6">
      <p className="text-sm text-rose-700">Something went wrong: {error.message}</p>
      <button type="button" onClick={reset} className="mt-2 rounded-md bg-slate-900 px-3 py-1 text-sm text-white">Try again</button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/atlas-web/app/projects/[projectId]/loading.tsx apps/atlas-web/app/projects/[projectId]/error.tsx
git commit -m "feat(atlas-web): per-project loading + error boundaries"
```

---

### Task 17: README

**Files:** `apps/atlas-web/README.md`.

````markdown
# atlas-web

Atlas's product surface — Next.js 15 App Router. Visualize → Agree → Build ritual UI for the three personas (Ama, Diego, Priya).

## Quickstart

```bash
# 1. Bring up Postgres (A.1's docker-compose)
pnpm db:up

# 2. Apply latest migrations (includes user_project_preferences)
pnpm -F @atlas/spec-graph-data migrate:up   # (or whatever A.1's helper is named)

# 3. Set Clerk + DB env
cp apps/atlas-web/.env.example apps/atlas-web/.env.local
# fill in Clerk publishable + secret keys from your dev dashboard

# 4. Dev server
pnpm -F atlas-web dev
```

Open http://localhost:3000. Sign up → land on the project list → "New project" → Canvas opens.

## Architecture

- **Server Components** own data fetching + Clerk auth gating.
- **Server Actions** (`lib/actions/*.ts`) wrap `@atlas/ritual-engine`. Browser code never imports the engine directly.
- **Client Components** (`components/*.tsx`) own interactivity — Canvas drag-rearrange, chat input, approval buttons.
- **Per-request cached `RitualEngine`** via React's `cache()` helper — multiple Server Actions in the same render share the same engine instance.

## Persona resolution

Two-layer:
1. Per-project override in `user_project_preferences` table (set via `setPersonaOverride` action).
2. Clerk user metadata `defaultPersona`.
3. Fallback: `ama` (least privileged).

The `<PersonaToggle>` writes to layer 1; layer 2 is set externally via Clerk dashboard or onboarding flow.

## Testing

```bash
pnpm -F atlas-web test           # vitest + jsdom + Testing Library
pnpm -F atlas-web typecheck
pnpm -F atlas-web lint
```

Component tests live under `test/components/`; Server Action tests under `test/actions/`. End-to-end Playwright tests land with Plan E.5.

## Env vars

| Var | Purpose |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk client SDK |
| `CLERK_SECRET_KEY` | Clerk server SDK |
| `DATABASE_URL` | Postgres for `@atlas/spec-graph-data` |

## What ships in E.2 vs later

| Feature | Plan |
|---|---|
| Next.js scaffold + Clerk + Tailwind | E.2 (this) |
| Canvas (React Flow) | E.2 |
| Persona toggle + override | E.2 |
| Server Actions: start / approve / accept-risk / escalate | E.2 |
| SSE events route (stub) | E.2 |
| Monaco editor + file tree + PR flow | E.3 |
| E2B sandbox + HMR iframe + multi-viewport preview | E.4 |
| Playwright e2e tests across personas | E.5 |
````

- [ ] **Commit**

```bash
git add apps/atlas-web/README.md
git commit -m "docs(atlas-web): README — architecture, persona resolution, env, scope per E.2/E.3/E.4/E.5"
```

---

### Task 18: Build smoke + workspace test sweep

- [ ] **Step 1: Build + typecheck + test**

```bash
pnpm -F atlas-web typecheck
pnpm -F atlas-web build
pnpm -F atlas-web test
pnpm -r test
```

Expected: `atlas-web` typechecks, builds, tests pass; `pnpm -r test` shows no regression in any workspace package (pre-existing Postgres flakiness in spec-graph-sync/merge-driver acceptable).

If `pnpm -F atlas-web build` fails on a Server Action that imports `@atlas/spec-graph-data` (which itself imports `pg`), confirm the workspace deps in `package.json` are correct. Server Actions only run server-side, so `pg` is fine.

- [ ] **Step 2: Commit checkpoint**

```bash
git commit --allow-empty -m "chore(atlas-web): full-suite smoke green post E.2"
```

---

### Task 19: Update plan index + handoff

**Files:** modify `docs/superpowers/plans/README.md`.

- [ ] **Step 1: Insert new row + refresh diagram**

Insert E.2 row in the Plan index after the E.1 row:

```
| 1X | `2026-04-20-atlas-web-canvas.md` | **E.2 — Atlas Web Scaffold + Canvas view** | Next.js 15 + Clerk + Tailwind + React Flow Canvas; Server Actions for start/approve/accept-risk/escalate; persona toggle (per-project override); Code view stub for E.3 | 19 tasks, TDD | Shipped (pending merge — TODO: update SHA post-merge) |
```

(Pick the actual row number based on the current index.)

Refresh execution-order diagram so E.2 appears under E.1 with E.3, E.4, E.5 as children.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/README.md
git commit -m "docs(plans): add E.2 atlas-web canvas to plan index"
```

---

## Completion Checklist

After all 19 tasks:

- [ ] `pnpm -F atlas-web typecheck` exits 0
- [ ] `pnpm -F atlas-web build` exits 0
- [ ] `pnpm -F atlas-web test` — all green (~14 component/action tests)
- [ ] `pnpm -F @atlas/spec-graph-data test preferences-repo` — green
- [ ] `pnpm -r test` — no cross-package regressions
- [ ] Sign-in → landing → new project → canvas page renders
- [ ] React Flow Canvas shows nodes + supports drag
- [ ] PersonaToggle + setPersonaOverride round-trips through `user_project_preferences`
- [ ] startRitual / approveRitual / acceptRiskAction / escalateRitual all wired and unit-tested
- [ ] PersonaGateError surfaces in UI as EscalationCallout
- [ ] SSE events route returns text/event-stream + heartbeat
- [ ] Code view stub renders + links from layout nav

## Handoff to E.3, E.4, E.5

- **E.3 (Code view + Monaco)**: replaces `app/projects/[projectId]/code/page.tsx` stub with the Monaco-backed three-pane layout. Imports `MonacoEditorWrapper`, `FileTree`, `RightPane` (PR / terminal / tests). Adds `openFile` / `saveFile` / PR Server Actions.
- **E.4 (E2B Sandbox + Preview)**: ships `packages/sandbox-e2b/`. Wires HMR iframe into Canvas page (sibling to React Flow). Replaces E.3's terminal + test-runner stubs with real sandbox connections. Adds `createShareableUrl` Server Action.
- **E.5 (Playwright E2E)**: runs end-to-end persona flows against the real Atlas Web app + a real `RitualEngine` + real Postgres + real E2B sandbox. Imports `data-testid` selectors that E.2-E.4 expose on key UI elements.
- **F.1 (Bootstrap Checkpoint)**: subscribes to the engine's `EventSink` from inside this app (production wiring). E.2 ships the engine factory; F.1 wires the checkpoint into the same per-request scope.
