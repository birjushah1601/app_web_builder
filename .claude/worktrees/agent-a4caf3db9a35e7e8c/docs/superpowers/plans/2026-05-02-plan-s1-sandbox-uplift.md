# Plan S.1 — Sandbox Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the developer's "inline-style React only" sandbox with a fully-loaded Next.js 15 + Tailwind 3 + shadcn/ui + lucide-react + framer-motion environment so generated UIs can use a real design system; rewrite `SANDBOX_CONTEXT_PROMPT` from a negative-list ("NO Tailwind, NO lucide") to a positive-list ("Tailwind 3 is installed, shadcn at @/components/ui/*, lucide-react for icons") so the model is asked to use the design system rather than warned against it.

**Architecture:** Two coordinated changes. **(1)** `packages/sandbox-e2b/templates/atlas-next-ts/` package.json moves Tailwind from devDeps to deps; gains `clsx`, `tailwind-variants`, `class-variance-authority`, the Radix primitives needed by shadcn (`@radix-ui/react-{slot,dialog,tabs,tooltip,dropdown-menu,label,separator}`), `tailwindcss-animate`. The template ships a curated subset of shadcn/ui components copied verbatim from the official registry (Button, Card, Input, Label, Dialog, DropdownMenu, Tabs, Tooltip, Badge, Separator, Skeleton). `tailwind.config.ts` extends the theme with CSS-variable scaffolding (`--atlas-color-*`, `--atlas-radius-*`) so the v1 Designer role's chosen `DesignTokens` later flow into the rendered output. `globals.css` adds `:root` CSS variables for the default theme. **(2)** `packages/role-developer/src/assemble-prompt.ts` `SANDBOX_CONTEXT_PROMPT` is rewritten to enumerate what IS available and how to use it, with explicit guidance to prefer shadcn over inline styles. The template image is then republished to E2B (manual operator step at the end of the plan; build artifacts and one-line republish command included).

**Tech Stack:** Next.js 15.5 · React 18.3 · TypeScript 5.6 · pnpm 9 · Tailwind 3.4 · shadcn/ui · Radix UI primitives · lucide-react 0.460 · framer-motion 11 · class-variance-authority · tailwind-variants · clsx · vitest 2 · E2B SDK + CLI.

**Prerequisites the implementing engineer needs installed before starting:**
- Node 22 LTS
- pnpm 9 (`npm i -g pnpm`)
- Docker (for local Dockerfile sanity-test of the template)
- An E2B account + `E2B_API_KEY` available (for the final republish step ONLY — implementation, code, and tests work without it)
- Repo state: on `main`, working tree clean, all existing tests green (`pnpm -r test`)

**Branch:** `plan-s1/sandbox-uplift` cut from `main`. Final task in this plan merges back to `main` after CI green.

---

## File Structure

Files this plan creates or modifies. Paths relative to repo root `f:/claude/ai_builder/`.

```
packages/sandbox-e2b/templates/atlas-next-ts/
  package.json                                      # MODIFIED: deps reshuffle (tailwind to runtime, add clsx/cva/tailwind-variants/radix-* /tailwindcss-animate)
  tailwind.config.ts                                # MODIFIED: extend theme with CSS-variable scaffolding for design tokens
  postcss.config.js                                 # already present; verified
  components.json                                   # NEW: shadcn/ui CLI config
  Dockerfile                                        # MODIFIED: COPY components.json + new src/components/ui/*
  README.md                                         # MODIFIED: dep list refresh
  src/
    app/
      globals.css                                   # MODIFIED: Tailwind layers + CSS vars + base font
      layout.tsx                                    # MODIFIED: import GeistSans (optional) — ship neutral defaults
      page.tsx                                      # MODIFIED: smoke-test page using Card + Button + lucide icon
    components/
      ui/                                           # NEW: 11 shadcn components copied from registry
        button.tsx
        card.tsx
        input.tsx
        label.tsx
        dialog.tsx
        dropdown-menu.tsx
        tabs.tsx
        tooltip.tsx
        badge.tsx
        separator.tsx
        skeleton.tsx
    lib/
      utils.ts                                      # NEW: shadcn-required `cn()` helper

packages/sandbox-e2b/templates/atlas-next-ts/scripts/
  build-template.sh                                 # NEW: convenience wrapper around `npx @e2b/cli template build`
  smoke-test-local.sh                               # NEW: docker build + curl localhost:3000 sanity check

packages/role-developer/
  src/
    assemble-prompt.ts                              # MODIFIED: SANDBOX_CONTEXT_PROMPT rewritten positive-list
  test/
    assemble-prompt.test.ts                         # NEW (does not currently exist): assert positive-list invariants

apps/atlas-web/
  .env.example                                      # MODIFIED: comment refresh on ATLAS_DEFAULT_SANDBOX_TEMPLATE

docs/superpowers/
  local-dev-status.md                               # MODIFIED: add a note in "What's wired" about S.1 sandbox uplift
```

**Why this shape.** All template additions live inside the template directory so the docker build context stays self-contained and minimal. shadcn components copied verbatim (not pulled via `npx shadcn add` at install time) so the template build is offline-deterministic. The `scripts/` subdirectory keeps build tooling next to the artifact it builds. `assemble-prompt.test.ts` for role-developer is a new file (the package has no current test for the prompt content); the prompt is the contract between Atlas and the LLM, so it deserves an invariants test that catches accidental regressions.

---

## Design Decisions

These resolve implementation-level questions left implicit in the spec.

1. **Why ship shadcn components copy-pasted vs. invoke `npx shadcn add` at template-build time.** Offline determinism. The E2B template build runs in a CI-style environment where pulling from external CLIs at build time is fragile. Each shadcn component is small (50–200 lines), under MIT, version-pinned via the version comment we copy in. This matches shadcn's own recommendation ("you own the code").

2. **Why CSS-variable scaffolding for design tokens (vs. raw Tailwind extension).** The S.4 Designer's `DesignTokens` payload becomes a small `<style>` block injected per project that sets `:root { --atlas-color-primary: <hex>; ... }`. shadcn components wired to `var(--atlas-color-*)` then re-skin without code changes. This is the standard shadcn theming pattern (their own docs use HSL CSS variables); we just rename the variable namespace to `atlas-*` to avoid collision with future shadcn updates.

3. **Why keep tailwind 3.4 (not migrate to tailwind 4 yet).** Tailwind 4 is in beta as of 2026-04. Atlas's stability-first posture means we wait. Migration is a follow-up plan with its own visual-regression check.

4. **Why a smoke-test-local.sh that requires Docker.** Catches Dockerfile breakage before the operator burns an E2B build credit. Optional (not on CI), useful in dev.

5. **Why a separate test file for SANDBOX_CONTEXT_PROMPT.** The prompt today is a 50+ line string-array with several no-no clauses; a test that grep-checks the rewritten version stays a safety net against accidental re-inclusion of "NO Tailwind" or similar negatives via merge conflicts.

6. **The smoke-test page (`src/app/page.tsx`)** is the LIVE proof that the template image works after rebuild. It uses Button + Card + lucide icon + Tailwind utilities + CSS-variable-driven color. If it renders correctly in `pnpm dev`, every shadcn primitive is wired correctly.

7. **No flag for this plan.** The sandbox-template change is invisible to flag-OFF callers; it just makes the developer's diff-apply succeed instead of fail when imports reference the new deps. The change is forward-compatible. Old developer-output (inline-style only) still works.

---

## Task List (16 tasks)

Each task is TDD-shaped: failing test first, run red, write minimal code, run green, commit. Every task ends with a Conventional Commits commit. Each task is independently committable and reviewable.

---

### Task 1: Cut branch + add runtime deps to template

**Files:**
- Create: `(branch)`
- Modify: `packages/sandbox-e2b/templates/atlas-next-ts/package.json`

- [ ] **Step 1: Cut the branch from main**

```bash
cd /f/claude/ai_builder
git checkout main
git pull --ff-only
git checkout -b plan-s1/sandbox-uplift
```

- [ ] **Step 2: Replace the template's package.json with the uplifted deps**

Open `packages/sandbox-e2b/templates/atlas-next-ts/package.json` and replace its full contents with:

```json
{
  "name": "atlas-next-ts-sandbox",
  "private": true,
  "version": "0.2.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "15.5.15",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "tailwindcss": "3.4.15",
    "postcss": "8.4.49",
    "autoprefixer": "10.4.20",
    "tailwindcss-animate": "1.0.7",
    "lucide-react": "0.460.0",
    "framer-motion": "11.11.17",
    "clsx": "2.1.1",
    "tailwind-variants": "0.3.0",
    "class-variance-authority": "0.7.0",
    "@radix-ui/react-slot": "1.1.0",
    "@radix-ui/react-dialog": "1.1.2",
    "@radix-ui/react-tabs": "1.1.1",
    "@radix-ui/react-tooltip": "1.1.4",
    "@radix-ui/react-dropdown-menu": "2.1.2",
    "@radix-ui/react-label": "2.1.0",
    "@radix-ui/react-separator": "1.1.0"
  },
  "devDependencies": {
    "@types/node": "22.9.0",
    "@types/react": "18.3.12",
    "@types/react-dom": "18.3.1",
    "typescript": "5.6.3"
  },
  "packageManager": "pnpm@9.12.0"
}
```

The version bump (0.1.0 → 0.2.0) marks the dep-set change. Tailwind moved from `devDependencies` to `dependencies` (it's runtime-imported by `globals.css` via PostCSS). Radix primitives are the underlying building blocks shadcn components use; ship the exact subset our 11 shadcn components need.

- [ ] **Step 3: Run pnpm install at the template directory to regenerate the lockfile entry**

```bash
cd packages/sandbox-e2b/templates/atlas-next-ts
pnpm install --no-frozen-lockfile
```

Expected: lockfile updates with new entries. No errors. (The template directory is excluded from the workspace via `pnpm-workspace.yaml`, so this is an isolated install.)

- [ ] **Step 4: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/package.json packages/sandbox-e2b/templates/atlas-next-ts/pnpm-lock.yaml
git commit -m "chore(sandbox): bump atlas-next-ts to v0.2 deps (shadcn primitives + tailwind runtime)"
```

---

### Task 2: Extend tailwind.config.ts with CSS-variable scaffolding

**Files:**
- Modify: `packages/sandbox-e2b/templates/atlas-next-ts/tailwind.config.ts`

- [ ] **Step 1: Replace the existing tailwind.config.ts**

Replace the contents of `packages/sandbox-e2b/templates/atlas-next-ts/tailwind.config.ts` with:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}"
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" }
    },
    extend: {
      colors: {
        border: "hsl(var(--atlas-border))",
        input: "hsl(var(--atlas-input))",
        ring: "hsl(var(--atlas-ring))",
        background: "hsl(var(--atlas-background))",
        foreground: "hsl(var(--atlas-foreground))",
        primary: {
          DEFAULT: "hsl(var(--atlas-primary))",
          foreground: "hsl(var(--atlas-primary-foreground))"
        },
        secondary: {
          DEFAULT: "hsl(var(--atlas-secondary))",
          foreground: "hsl(var(--atlas-secondary-foreground))"
        },
        destructive: {
          DEFAULT: "hsl(var(--atlas-destructive))",
          foreground: "hsl(var(--atlas-destructive-foreground))"
        },
        muted: {
          DEFAULT: "hsl(var(--atlas-muted))",
          foreground: "hsl(var(--atlas-muted-foreground))"
        },
        accent: {
          DEFAULT: "hsl(var(--atlas-accent))",
          foreground: "hsl(var(--atlas-accent-foreground))"
        },
        popover: {
          DEFAULT: "hsl(var(--atlas-popover))",
          foreground: "hsl(var(--atlas-popover-foreground))"
        },
        card: {
          DEFAULT: "hsl(var(--atlas-card))",
          foreground: "hsl(var(--atlas-card-foreground))"
        }
      },
      borderRadius: {
        lg: "var(--atlas-radius)",
        md: "calc(var(--atlas-radius) - 2px)",
        sm: "calc(var(--atlas-radius) - 4px)"
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" }
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" }
        }
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out"
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};

export default config;
```

This is the canonical shadcn/ui tailwind.config shape with the `--atlas-*` namespace (instead of shadcn's default `--*`) so future shadcn registry pulls don't collide.

- [ ] **Step 2: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/tailwind.config.ts
git commit -m "feat(sandbox): atlas-next-ts tailwind.config with CSS-variable design-token scaffolding"
```

---

### Task 3: Update globals.css with Tailwind layers + base CSS variables

**Files:**
- Modify: `packages/sandbox-e2b/templates/atlas-next-ts/src/app/globals.css`

- [ ] **Step 1: Replace globals.css**

Replace the contents of `packages/sandbox-e2b/templates/atlas-next-ts/src/app/globals.css` with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Default theme — overridden by per-project DesignTokens injection (Plan S.4). */
    --atlas-background: 0 0% 100%;
    --atlas-foreground: 222.2 84% 4.9%;
    --atlas-card: 0 0% 100%;
    --atlas-card-foreground: 222.2 84% 4.9%;
    --atlas-popover: 0 0% 100%;
    --atlas-popover-foreground: 222.2 84% 4.9%;
    --atlas-primary: 222.2 47.4% 11.2%;
    --atlas-primary-foreground: 210 40% 98%;
    --atlas-secondary: 210 40% 96.1%;
    --atlas-secondary-foreground: 222.2 47.4% 11.2%;
    --atlas-muted: 210 40% 96.1%;
    --atlas-muted-foreground: 215.4 16.3% 46.9%;
    --atlas-accent: 210 40% 96.1%;
    --atlas-accent-foreground: 222.2 47.4% 11.2%;
    --atlas-destructive: 0 84.2% 60.2%;
    --atlas-destructive-foreground: 210 40% 98%;
    --atlas-border: 214.3 31.8% 91.4%;
    --atlas-input: 214.3 31.8% 91.4%;
    --atlas-ring: 222.2 84% 4.9%;
    --atlas-radius: 0.5rem;
  }

  * {
    @apply border-border;
  }

  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }
}
```

Defaults match shadcn's neutral light theme. Per-project Designer overrides arrive in S.4 as a small `<style data-atlas-theme>:root { --atlas-primary: ... }</style>` block injected at the page layout level.

- [ ] **Step 2: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/src/app/globals.css
git commit -m "feat(sandbox): globals.css gains @layer base + atlas-* CSS variables"
```

---

### Task 4: Add shadcn components.json + lib/utils.ts

**Files:**
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/components.json`
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/lib/utils.ts`

- [ ] **Step 1: Create components.json**

Create `packages/sandbox-e2b/templates/atlas-next-ts/components.json` with:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": "atlas-"
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 2: Create lib/utils.ts (the canonical shadcn `cn()` helper)**

Create `packages/sandbox-e2b/templates/atlas-next-ts/src/lib/utils.ts` with:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Note `tailwind-merge` is a peer of `clsx` here. Add it to deps in the next step.

- [ ] **Step 3: Add tailwind-merge to template package.json**

Open `packages/sandbox-e2b/templates/atlas-next-ts/package.json`. Add to `dependencies`:

```json
    "tailwind-merge": "2.5.4",
```

(insert alphabetically between `tailwind-variants` and `tailwindcss-animate`).

Run from the template directory:

```bash
cd packages/sandbox-e2b/templates/atlas-next-ts
pnpm install --no-frozen-lockfile
```

Expected: lockfile updates with `tailwind-merge`.

- [ ] **Step 4: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/components.json \
        packages/sandbox-e2b/templates/atlas-next-ts/src/lib/utils.ts \
        packages/sandbox-e2b/templates/atlas-next-ts/package.json \
        packages/sandbox-e2b/templates/atlas-next-ts/pnpm-lock.yaml
git commit -m "feat(sandbox): add shadcn components.json + lib/utils cn() helper + tailwind-merge"
```

---

### Task 5: Add shadcn UI components — Button + Card + Input + Label

**Files:**
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/button.tsx`
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/card.tsx`
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/input.tsx`
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/label.tsx`

- [ ] **Step 1: Create button.tsx (verbatim from shadcn registry, default style)**

Create `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/button.tsx`:

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10"
      }
    },
    defaultVariants: { variant: "default", size: "default" }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

- [ ] **Step 2: Create card.tsx**

Create `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/card.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
```

- [ ] **Step 3: Create input.tsx**

Create `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/input.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
```

- [ ] **Step 4: Create label.tsx**

Create `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/label.tsx`:

```tsx
"use client";
import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const labelVariants = cva("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70");

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
```

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/button.tsx \
        packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/card.tsx \
        packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/input.tsx \
        packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/label.tsx
git commit -m "feat(sandbox): add shadcn primitives — Button, Card, Input, Label"
```

---

### Task 6: Add shadcn UI components — Dialog + DropdownMenu + Tabs + Tooltip

**Files:**
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/dialog.tsx`
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/dropdown-menu.tsx`
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/tabs.tsx`
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/tooltip.tsx`

- [ ] **Step 1: Create dialog.tsx**

Create `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/dialog.tsx`:

```tsx
"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription
};
```

- [ ] **Step 2: Create dropdown-menu.tsx**

Create `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/dropdown-menu.tsx`:

```tsx
"use client";
import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const DropdownMenu = DropdownMenuPrimitive.Root;
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
const DropdownMenuGroup = DropdownMenuPrimitive.Group;
const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
const DropdownMenuSub = DropdownMenuPrimitive.Sub;
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & { inset?: boolean }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg",
      className
    )}
    {...props}
  />
));
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label ref={ref} className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)} {...props} />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("ml-auto text-xs tracking-widest opacity-60", className)} {...props} />
);
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup
};
```

- [ ] **Step 3: Create tabs.tsx**

Create `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/tabs.tsx`:

```tsx
"use client";
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn("inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground", className)}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
```

- [ ] **Step 4: Create tooltip.tsx**

Create `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/tooltip.tsx`:

```tsx
"use client";
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md",
      className
    )}
    {...props}
  />
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
```

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/dialog.tsx \
        packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/dropdown-menu.tsx \
        packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/tabs.tsx \
        packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/tooltip.tsx
git commit -m "feat(sandbox): add shadcn primitives — Dialog, DropdownMenu, Tabs, Tooltip"
```

---

### Task 7: Add shadcn UI components — Badge + Separator + Skeleton

**Files:**
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/badge.tsx`
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/separator.tsx`
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/skeleton.tsx`

- [ ] **Step 1: Create badge.tsx**

Create `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/badge.tsx`:

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground"
      }
    },
    defaultVariants: { variant: "default" }
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
```

- [ ] **Step 2: Create separator.tsx**

Create `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/separator.tsx`:

```tsx
"use client";
import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "@/lib/utils";

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      "shrink-0 bg-border",
      orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
      className
    )}
    {...props}
  />
));
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
```

- [ ] **Step 3: Create skeleton.tsx**

Create `packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/skeleton.tsx`:

```tsx
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

export { Skeleton };
```

- [ ] **Step 4: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/badge.tsx \
        packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/separator.tsx \
        packages/sandbox-e2b/templates/atlas-next-ts/src/components/ui/skeleton.tsx
git commit -m "feat(sandbox): add shadcn primitives — Badge, Separator, Skeleton"
```

---

### Task 8: Update tsconfig.json for path alias `@/*`

**Files:**
- Modify: `packages/sandbox-e2b/templates/atlas-next-ts/tsconfig.json`

- [ ] **Step 1: Read the current tsconfig**

```bash
cat packages/sandbox-e2b/templates/atlas-next-ts/tsconfig.json
```

- [ ] **Step 2: Replace its contents with shadcn-compatible aliases**

Replace `packages/sandbox-e2b/templates/atlas-next-ts/tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

The `@/*` path alias is what shadcn expects (e.g., `import { cn } from "@/lib/utils";`).

- [ ] **Step 3: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/tsconfig.json
git commit -m "feat(sandbox): tsconfig path alias @/* → src/*"
```

---

### Task 9: Smoke-test page using shadcn + lucide

**Files:**
- Modify: `packages/sandbox-e2b/templates/atlas-next-ts/src/app/page.tsx`
- Modify: `packages/sandbox-e2b/templates/atlas-next-ts/src/app/layout.tsx`

- [ ] **Step 1: Replace page.tsx with the shadcn smoke-test page**

Replace `packages/sandbox-e2b/templates/atlas-next-ts/src/app/page.tsx` with:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

export default function Page() {
  return (
    <main className="container mx-auto flex min-h-screen items-center justify-center p-8">
      <Card className="max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="text-primary" />
            <CardTitle>Atlas sandbox is live</CardTitle>
            <Badge variant="secondary">v0.2 · shadcn-ready</Badge>
          </div>
          <CardDescription>
            This blank Next.js + Tailwind + shadcn/ui app is the starting point. Atlas&apos;s developer
            role will write code into <code className="rounded bg-muted px-1 py-0.5 text-xs">/code/src/</code>;
            the dev server picks it up via HMR and you&apos;ll see it here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button>Primary action</Button>
          <Button variant="outline">Secondary</Button>
        </CardContent>
      </Card>
    </main>
  );
}
```

Note: every dep here (Card, Button, Badge, Sparkles) gets exercised. If the template image is broken, this page fails to render — best smoke-test we can ship.

- [ ] **Step 2: Update layout.tsx to ensure `globals.css` is imported and metadata is sensible**

Replace `packages/sandbox-e2b/templates/atlas-next-ts/src/app/layout.tsx` with:

```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Atlas Sandbox",
  description: "Live preview running inside Atlas's E2B sandbox."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/src/app/page.tsx \
        packages/sandbox-e2b/templates/atlas-next-ts/src/app/layout.tsx
git commit -m "feat(sandbox): smoke-test page exercises Card + Button + Badge + lucide icon"
```

---

### Task 10: Update Dockerfile to COPY new files

**Files:**
- Modify: `packages/sandbox-e2b/templates/atlas-next-ts/Dockerfile`

- [ ] **Step 1: Replace Dockerfile**

Replace `packages/sandbox-e2b/templates/atlas-next-ts/Dockerfile` with:

```dockerfile
# atlas-next-ts: Next.js 15 + Tailwind 3 + shadcn/ui dev sandbox for Atlas live preview.
#
# Hand-authored minimal Next.js app — no `create-next-app` scaffolding,
# which is interactive (asks about Turbopack) and broke E2B template
# builds running under non-TTY docker contexts.
FROM e2bdev/code-interpreter:latest

USER root

# Install Node 22 LTS (the e2b base ships with an older Node).
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@9

WORKDIR /code

# Hand-author the app structure so the build is deterministic.
RUN mkdir -p src/app src/components/ui src/lib

# Top-level config files.
COPY package.json tsconfig.json next.config.mjs tailwind.config.ts postcss.config.js components.json ./

# App router entries.
COPY src/app/layout.tsx src/app/page.tsx src/app/globals.css ./src/app/

# shadcn primitives (11 components).
COPY src/components/ui/*.tsx ./src/components/ui/

# Utility (cn helper).
COPY src/lib/utils.ts ./src/lib/

# Install via pnpm (matches Atlas's monorepo PM choice).
RUN pnpm install --prod=false \
 && chown -R user:user /code

USER user

EXPOSE 3000

# Note: e2b.toml's start_cmd overrides this CMD at sandbox boot, but
# CMD is still useful for `docker run` smoke-testing the image locally.
CMD ["pnpm", "dev", "--hostname", "0.0.0.0", "--port", "3000"]
```

- [ ] **Step 2: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/Dockerfile
git commit -m "feat(sandbox): Dockerfile COPYs components.json + ui components + lib utils"
```

---

### Task 11: Add scripts/build-template.sh + scripts/smoke-test-local.sh

**Files:**
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/scripts/build-template.sh`
- Create: `packages/sandbox-e2b/templates/atlas-next-ts/scripts/smoke-test-local.sh`

- [ ] **Step 1: Create build-template.sh**

Create `packages/sandbox-e2b/templates/atlas-next-ts/scripts/build-template.sh`:

```bash
#!/usr/bin/env bash
# Build + push the atlas-next-ts E2B template image.
# Usage: ./scripts/build-template.sh
# Requires: E2B_API_KEY env var set; npx + node 22+ available.

set -euo pipefail

if [[ -z "${E2B_API_KEY:-}" ]]; then
  echo "ERROR: E2B_API_KEY env var not set."
  echo "Get one from https://e2b.dev → Dashboard → API Keys"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "Building atlas-next-ts E2B template (this takes ~3-5 min)..."
npx --yes @e2b/cli template build

echo ""
echo "Build complete. Capture the printed Template ID and update:"
echo "  apps/atlas-web/.env.local  →  ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-next-ts"
echo ""
echo "Then restart atlas-web (pnpm -F atlas-web dev) and provision a new sandbox to test."
```

- [ ] **Step 2: Create smoke-test-local.sh**

Create `packages/sandbox-e2b/templates/atlas-next-ts/scripts/smoke-test-local.sh`:

```bash
#!/usr/bin/env bash
# Build the template image locally (no push to E2B) and curl it.
# Catches Dockerfile bugs without burning E2B build credits.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

IMAGE_TAG="atlas-next-ts:smoke"
CONTAINER_NAME="atlas-next-ts-smoke"

echo "Building local image $IMAGE_TAG..."
docker build -t "$IMAGE_TAG" .

# Stop any prior smoke-test container.
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

echo "Starting container on port 3000..."
docker run -d --name "$CONTAINER_NAME" -p 3000:3000 "$IMAGE_TAG"

# Wait up to 30s for dev server to come up.
echo "Waiting for dev server..."
for i in {1..30}; do
  if curl -fsS http://localhost:3000 > /dev/null; then
    echo "✓ http://localhost:3000 returns 200"
    echo "Open http://localhost:3000 in a browser to visually verify the smoke-test page."
    echo ""
    echo "Cleanup: docker rm -f $CONTAINER_NAME"
    exit 0
  fi
  sleep 1
done

echo "✗ Dev server did not come up within 30s. Check logs:"
docker logs "$CONTAINER_NAME"
exit 1
```

- [ ] **Step 3: Mark scripts executable**

```bash
chmod +x packages/sandbox-e2b/templates/atlas-next-ts/scripts/build-template.sh \
         packages/sandbox-e2b/templates/atlas-next-ts/scripts/smoke-test-local.sh
```

- [ ] **Step 4: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/scripts/build-template.sh \
        packages/sandbox-e2b/templates/atlas-next-ts/scripts/smoke-test-local.sh
git commit -m "feat(sandbox): build-template + smoke-test-local convenience scripts"
```

---

### Task 12: Add vitest test scaffold for role-developer's assemble-prompt

**Files:**
- Create: `packages/role-developer/test/assemble-prompt.test.ts`
- Modify (if needed): `packages/role-developer/vitest.config.ts`

- [ ] **Step 1: Verify vitest config picks up test/ directory**

```bash
cat packages/role-developer/vitest.config.ts
```

If `include` does not list `test/**/*.test.ts`, ensure it does. Typical config:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" }
});
```

If the file already includes that pattern, skip; otherwise add it.

- [ ] **Step 2: Write the failing test asserting positive-list invariants**

Create `packages/role-developer/test/assemble-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SANDBOX_CONTEXT_PROMPT } from "../src/assemble-prompt.js";

describe("SANDBOX_CONTEXT_PROMPT", () => {
  it("describes Tailwind as available (positive list)", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/Tailwind/i);
    expect(SANDBOX_CONTEXT_PROMPT).not.toMatch(/NO Tailwind/i);
  });

  it("describes shadcn/ui as available", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/shadcn/i);
  });

  it("describes lucide-react as available for icons", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/lucide-react/);
    expect(SANDBOX_CONTEXT_PROMPT).not.toMatch(/NO lucide-react/i);
  });

  it("describes framer-motion as available for animation", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/framer-motion/);
    expect(SANDBOX_CONTEXT_PROMPT).not.toMatch(/NO framer-motion/i);
  });

  it("retains the diff-format contract (CRITICAL section)", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/Diff format \(CRITICAL\)/);
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/--- \/dev\/null/);
  });

  it("warns against creating top-level index.html", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/Do.*NOT.*index\.html/i);
  });

  it("guides toward shadcn over inline styles", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/@\/components\/ui/);
  });

  it("explains design-token CSS variables", () => {
    expect(SANDBOX_CONTEXT_PROMPT).toMatch(/--atlas-/);
  });
});
```

- [ ] **Step 3: Run test — expect failure (current prompt is negative-list)**

```bash
pnpm --filter @atlas/role-developer test test/assemble-prompt.test.ts
```

Expected: 6+ failures with messages like "Expected 'NO Tailwind' to not match" — the current prompt explicitly says NO Tailwind etc. The test is red, prompt rewrite in next task makes it green.

- [ ] **Step 4: Commit (test only, red)**

```bash
git add packages/role-developer/test/assemble-prompt.test.ts
git commit -m "test(role-developer): assemble-prompt invariants — Tailwind/shadcn/lucide positive list"
```

---

### Task 13: Rewrite SANDBOX_CONTEXT_PROMPT to positive list

**Files:**
- Modify: `packages/role-developer/src/assemble-prompt.ts`

- [ ] **Step 1: Replace SANDBOX_CONTEXT_PROMPT**

Open `packages/role-developer/src/assemble-prompt.ts`. Replace the current `export const SANDBOX_CONTEXT_PROMPT = ...` block (lines ~20-54) with:

```ts
export const SANDBOX_CONTEXT_PROMPT = [
  "## Target sandbox",
  "",
  "Your diff will be applied to a live Next.js 15 + Tailwind 3 + shadcn/ui project (App Router, TypeScript) running in an E2B sandbox (template: atlas-next-ts v0.2).",
  "",
  "- The dev-server entry is **`src/app/page.tsx`** — the URL `/` renders whatever this file exports as `default`.",
  "- You may also create new files under `src/app/`, `src/components/`, `src/lib/`, `public/`, or extend `src/app/globals.css`. The Next dev server hot-reloads these.",
  "- Do **NOT** write a top-level `index.html` or static HTML files at the project root. The Next dev server will not serve them — the preview iframe will stay blank.",
  "",
  "## What's installed (use these — don't reinvent)",
  "",
  "- **Tailwind CSS 3.4** — fully configured. Use utility classes freely (`className=\"flex items-center gap-2 rounded-lg bg-card p-6 text-card-foreground shadow-sm\"`). Theme uses `hsl(var(--atlas-*))` CSS variables (see Design tokens below).",
  "- **shadcn/ui** components at `@/components/ui/*` — import like `import { Button } from \"@/components/ui/button\"`. Available primitives:",
  "  - `Button` (variants: default, destructive, outline, secondary, ghost, link · sizes: default, sm, lg, icon)",
  "  - `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`",
  "  - `Input`, `Label`",
  "  - `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`",
  "  - `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`",
  "  - `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`",
  "  - `Tooltip`, `TooltipProvider`, `TooltipTrigger`, `TooltipContent`",
  "  - `Badge` (variants: default, secondary, destructive, outline)",
  "  - `Separator`, `Skeleton`",
  "- **lucide-react 0.460** for icons — `import { ArrowRight, Sparkles } from \"lucide-react\";` then `<ArrowRight className=\"h-4 w-4\" />`. Prefer lucide over emoji or inline SVG.",
  "- **framer-motion 11** for animation — `import { motion, AnimatePresence } from \"framer-motion\";`. Use sparingly; CSS transitions cover most cases.",
  "- **clsx + tailwind-merge** via `cn()` — `import { cn } from \"@/lib/utils\";` for conditional class composition: `<div className={cn(\"base\", isActive && \"bg-primary\")} />`.",
  "",
  "## Design tokens (CSS variables)",
  "",
  "The atlas-next-ts template ships these CSS variables in `src/app/globals.css` (overridable per project by Atlas's Designer role):",
  "",
  "- Colors: `--atlas-background`, `--atlas-foreground`, `--atlas-card`, `--atlas-card-foreground`, `--atlas-primary`, `--atlas-primary-foreground`, `--atlas-secondary`, `--atlas-secondary-foreground`, `--atlas-muted`, `--atlas-muted-foreground`, `--atlas-accent`, `--atlas-accent-foreground`, `--atlas-destructive`, `--atlas-destructive-foreground`, `--atlas-border`, `--atlas-input`, `--atlas-ring`",
  "- Radius: `--atlas-radius` (defaults to 0.5rem)",
  "",
  "Tailwind utility names (`bg-primary`, `text-card-foreground`, `rounded-lg`, etc.) map to these via `tailwind.config.ts`. Use the utility names — don't write `style={{ backgroundColor: 'hsl(var(--atlas-primary))' }}`.",
  "",
  "## Fallbacks",
  "",
  "- If a layout truly has no Tailwind utility for what you need, inline `style={{ ... }}` is acceptable but rare.",
  "- If you need a UI primitive not in the shadcn list above (e.g., DataTable, Calendar), build it from Radix primitives + Tailwind — the project package.json includes the required @radix-ui/react-* deps.",
  "- Do NOT add new npm dependencies via package.json patches unless the user explicitly asks. Adding a dep means a new sandbox build, which doesn't happen automatically.",
  "",
  "## Diff format (CRITICAL)",
  "",
  "Emit ONE unified diff with multiple file hunks. For every file you intend to fully own, emit it as a **brand-new file from `/dev/null`** even if the file already exists in the sandbox. This sidesteps context-line mismatches when the existing file's contents differ from what you'd expect (E2B template versions drift, prior rituals may have edited it, etc.):",
  "",
  "```",
  "diff --git a/src/app/page.tsx b/src/app/page.tsx",
  "new file mode 100644",
  "--- /dev/null",
  "+++ b/src/app/page.tsx",
  "@@ -0,0 +1,N @@",
  "+<full file contents, line by line, each prefixed with +>",
  "```",
  "",
  "The hunk header `@@ -0,0 +1,N @@` MUST declare the exact count of `+` lines that follow — off-by-one truncates the file at the sandbox. Count carefully.",
  "",
  "Use modify-style diffs (with `-` context lines) ONLY for tiny one-line tweaks where you're certain of the existing file's exact content. When in doubt, full-file replace via `/dev/null`.",
  ""
].join("\n");
```

The `JSDoc` comment block above the constant in the existing file should also be replaced. Replace lines 4-19 (the `/** ... */` block) with this shorter rationale:

```ts
/**
 * Context block describing the live preview sandbox the developer's diff
 * will be applied to. The current default is the atlas-next-ts E2B
 * template (v0.2+) shipping Next.js 15 + Tailwind 3 + shadcn/ui +
 * lucide-react + framer-motion. The prompt explicitly enumerates the
 * available primitives so the model leans on the design system rather
 * than reinventing components in inline-style React.
 *
 * v0.1 of this prompt was a negative-list ("NO Tailwind, NO lucide") to
 * match an under-built template image. Plan S.1 (Sandbox Uplift, 2026-05)
 * rebuilt the image and reversed the prompt's polarity.
 */
```

- [ ] **Step 2: Run the test from Task 12 — expect green**

```bash
pnpm --filter @atlas/role-developer test test/assemble-prompt.test.ts
```

Expected: all assertions pass.

- [ ] **Step 3: Run the full role-developer test suite — expect no regressions**

```bash
pnpm --filter @atlas/role-developer test
```

Expected: all tests green (the existing 30 tests plus the new 8).

- [ ] **Step 4: Commit**

```bash
git add packages/role-developer/src/assemble-prompt.ts
git commit -m "feat(role-developer): SANDBOX_CONTEXT_PROMPT v2 — positive list (Tailwind + shadcn + lucide + framer-motion + atlas-* tokens)"
```

---

### Task 14: Update template README + .env.example documentation

**Files:**
- Modify: `packages/sandbox-e2b/templates/atlas-next-ts/README.md`
- Modify: `apps/atlas-web/.env.example`

- [ ] **Step 1: Replace template README**

Replace `packages/sandbox-e2b/templates/atlas-next-ts/README.md` with:

```markdown
# atlas-next-ts E2B template (v0.2)

The Next.js 15 + Tailwind 3 + shadcn/ui sandbox image used by Atlas's live-preview iframe. Builds a Node 22 + pnpm 9 + Next 15 + Tailwind 3 + shadcn/ui + lucide-react + framer-motion environment with `pnpm dev` auto-starting on port 3000.

## Pre-installed runtime deps

The developer role's prompt assumes these are available; rebuild the template after editing `package.json`:

- **next 15.5** + **react 18.3** + **react-dom 18.3**
- **tailwindcss 3.4** + tailwind-merge + tailwind-variants + tailwindcss-animate + clsx + class-variance-authority
- **@radix-ui/react-{slot,dialog,tabs,tooltip,dropdown-menu,label,separator}** — primitives shadcn components depend on
- **shadcn/ui components** copied verbatim into `src/components/ui/`: Button, Card, Input, Label, Dialog, DropdownMenu, Tabs, Tooltip, Badge, Separator, Skeleton
- **lucide-react 0.460** (icons)
- **framer-motion 11.11** (animations)

If you add or remove a dep here, also update `SANDBOX_CONTEXT_PROMPT` in `packages/role-developer/src/assemble-prompt.ts` so the developer model knows what's actually importable. The `assemble-prompt.test.ts` invariants will catch most regressions on the prompt side.

## Design tokens

`tailwind.config.ts` maps Tailwind utility colors to CSS variables in the `--atlas-*` namespace. Defaults are defined in `src/app/globals.css`. Atlas's Designer role (Plan S.3) injects per-project overrides as a `<style data-atlas-theme>` block at the layout level.

## Local smoke test (no E2B credit)

```bash
cd packages/sandbox-e2b/templates/atlas-next-ts
./scripts/smoke-test-local.sh
```

This builds the Dockerfile locally, runs the container on `localhost:3000`, and curls it. Catches bad imports, missing files, broken Tailwind config without burning an E2B build credit.

## Build + push to E2B

```bash
cd packages/sandbox-e2b/templates/atlas-next-ts
export E2B_API_KEY=e2b_...    # your account key
./scripts/build-template.sh
```

The CLI builds the image, pushes it to E2B, and prints the template ID + name. After a successful build:

```
Template ID: <some-alphanumeric-id>
Template Name: atlas-next-ts
```

## Wire into atlas-web

`apps/atlas-web/.env.local` should already have:

```bash
ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-next-ts
ATLAS_DEFAULT_SANDBOX_PORT=3000
```

Restart the Next dev server (`pnpm -F atlas-web dev`). The next sandbox-provision will use the rebuilt v0.2 image.

## Notes

- `start_cmd` in `e2b.toml` is what makes the dev server come up automatically — Dockerfile `CMD` is informational only; E2B overrides it at sandbox boot with `start_cmd`.
- `--hostname 0.0.0.0` is **required**. Without it, Next binds to localhost inside the container and E2B's port forwarding returns "Connection refused on port 3000."
- First sandbox cold-start takes ~5-8s for `pnpm dev` to come up. The factory's preview-URL synthesis happens before that completes; the iframe will retry on its own.
- This template scaffolds a *blank* Next.js + shadcn app at build time. Atlas's developer role then uses `E2BFileSystem` to write user-generated code into `/code/src/` while the dev server picks it up via HMR.
```

- [ ] **Step 2: Update .env.example with a refreshed comment**

Open `apps/atlas-web/.env.example`. Find the `ATLAS_DEFAULT_SANDBOX_TEMPLATE` line and replace its accompanying comment with:

```bash
# Template name (or ID) of the E2B sandbox image used for live preview.
# Default: atlas-next-ts (Next.js 15 + Tailwind 3 + shadcn/ui + lucide-react).
# Republish via packages/sandbox-e2b/templates/atlas-next-ts/scripts/build-template.sh
ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-next-ts
ATLAS_DEFAULT_SANDBOX_PORT=3000
```

(Leave the existing E2B_API_KEY entry untouched — it has its own comments.)

- [ ] **Step 3: Commit**

```bash
git add packages/sandbox-e2b/templates/atlas-next-ts/README.md apps/atlas-web/.env.example
git commit -m "docs(sandbox): atlas-next-ts v0.2 README + .env.example refresh"
```

---

### Task 15: Update local-dev-status with the sandbox uplift note

**Files:**
- Modify: `docs/superpowers/local-dev-status.md`

- [ ] **Step 1: Add a new "What's wired" entry**

Open `docs/superpowers/local-dev-status.md`. Find the line beginning with `- **Plan P: streaming live progress.**` (the last currently-listed plan). After it, add:

```markdown
- **Plan S.1: Sandbox Uplift.** The `atlas-next-ts` E2B template image (v0.2+) ships Tailwind 3 + shadcn/ui (11 primitives at `@/components/ui/*`) + lucide-react + framer-motion + atlas-* CSS-variable design tokens. The Developer role's `SANDBOX_CONTEXT_PROMPT` now enumerates these as available rather than forbidden. Republish via `packages/sandbox-e2b/templates/atlas-next-ts/scripts/build-template.sh` after pulling this change. Existing flag-OFF developer outputs (inline-style React) still work — the change is forward-compatible.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/local-dev-status.md
git commit -m "docs: log Plan S.1 sandbox uplift in local-dev-status"
```

---

### Task 16: Run full repo test suite + open the PR

**Files:**
- (no file edits — verification + handoff)

- [ ] **Step 1: Run the workspace-wide tests**

```bash
pnpm -r --no-bail typecheck && pnpm -r --no-bail test
```

Expected: every workspace package green. The new role-developer test added 8 cases; the rest unchanged.

- [ ] **Step 2: Run a local Dockerfile smoke test (optional but recommended)**

```bash
cd packages/sandbox-e2b/templates/atlas-next-ts
./scripts/smoke-test-local.sh
```

Expected: container starts, `curl http://localhost:3000` returns 200, the smoke-test page renders shadcn Card + Button + lucide Sparkles icon.

- [ ] **Step 3: Push the branch + open PR**

```bash
git push -u origin plan-s1/sandbox-uplift
gh pr create --title "Plan S.1 — Sandbox uplift (Tailwind + shadcn + lucide really installed)" --body "$(cat <<'EOF'
## Summary
- Bumps `atlas-next-ts` E2B template to v0.2 with Tailwind 3 + shadcn/ui (11 primitives) + lucide-react + framer-motion + clsx + atlas-* CSS-variable design tokens.
- Rewrites `SANDBOX_CONTEXT_PROMPT` from negative-list to positive-list so the developer model uses the design system instead of being warned against it.
- Adds `assemble-prompt.test.ts` invariants (8 cases) so the prompt can't accidentally regress.
- Ships `scripts/build-template.sh` (E2B push) + `scripts/smoke-test-local.sh` (Docker-only sanity check).

## Operator post-merge step (REQUIRED)

After merging, an operator with E2B credentials runs:

\`\`\`bash
cd packages/sandbox-e2b/templates/atlas-next-ts
export E2B_API_KEY=...
./scripts/build-template.sh
\`\`\`

This republishes the image to E2B's platform. Until that happens, atlas-web sandboxes still use the v0.1 image (which lacks the new deps). Mismatch is invisible to flag-OFF callers but will surface as `Module not found` errors if the Developer's diff imports shadcn/lucide/framer-motion before the rebuild lands.

## Test plan
- [ ] `pnpm -r test` — all 32 packages green; role-developer suite has 8 new assertions for the positive-list prompt
- [ ] `./scripts/smoke-test-local.sh` from inside the template directory — container comes up, curl returns 200
- [ ] After E2B republish: provision a fresh sandbox via atlas-web, confirm a Developer-generated diff using `<Button>` from shadcn renders without import errors

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: After review + merge: operator runs the rebuild**

This step is OUT OF SCOPE for the implementing engineer's TDD loop — it modifies shared infrastructure (E2B's hosted template registry). After PR merge, an operator with `E2B_API_KEY` runs:

```bash
cd packages/sandbox-e2b/templates/atlas-next-ts
./scripts/build-template.sh
```

Capture the printed Template ID. Verify the next atlas-web sandbox provision (open the project canvas, type a Send) hits the new image — a Developer diff using shadcn `<Button>` should now apply cleanly.

---

## Completion Checklist

- [ ] Branch `plan-s1/sandbox-uplift` cut from `main`
- [ ] Template package.json: tailwind moved to runtime, +radix primitives + clsx + cva + tailwind-variants + tailwind-merge + tailwindcss-animate
- [ ] tailwind.config.ts: extended theme with `--atlas-*` CSS variables + tailwindcss-animate plugin
- [ ] globals.css: `:root` block with default `--atlas-*` token values
- [ ] components.json + lib/utils.ts (cn helper) added
- [ ] 11 shadcn primitives in `src/components/ui/` (Button, Card, Input, Label, Dialog, DropdownMenu, Tabs, Tooltip, Badge, Separator, Skeleton)
- [ ] tsconfig path alias `@/* → src/*`
- [ ] page.tsx smoke-test exercises every dep family (Card + Button + Badge + lucide icon)
- [ ] Dockerfile COPYs all new files + lib + components/ui
- [ ] scripts/build-template.sh + scripts/smoke-test-local.sh executable
- [ ] role-developer assemble-prompt.test.ts (8 invariants) — tests fail with v1 prompt, pass with v2
- [ ] SANDBOX_CONTEXT_PROMPT rewritten as positive list
- [ ] Template README updated for v0.2
- [ ] .env.example comment refresh
- [ ] local-dev-status.md "What's wired" entry added
- [ ] `pnpm -r test` green
- [ ] PR opened, reviewed, merged
- [ ] **Operator post-merge:** E2B template republished

---

## Handoff to Plan S.2

Once Plan S.1 merges and the E2B template is republished, **Plan S.2 (Researcher Role + Local Catalog)** can begin. S.2 is independent of S.1 in code (it's a separate package, separate flag), but the demo flow only delivers visible UI quality after BOTH S.1 (sandbox can render shadcn) and S.4 (Designer's tokens flow into per-project theme overrides) land.

S.2 plan: `docs/superpowers/plans/2026-05-02-plan-s2-researcher-catalog.md`.
