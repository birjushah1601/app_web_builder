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
