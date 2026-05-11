# atlas-next-ts E2B template

The Next.js 15 sandbox image used by Atlas's live-preview iframe. Builds a Node 22 + pnpm 9 + Next 15 + Tailwind 3 + lucide-react + framer-motion environment with `pnpm dev` auto-starting on port 3000.

## Pre-installed runtime deps

The developer role's prompt assumes these are available; rebuild the template after editing `package.json`:

- **next 15.5** + **react 18.3** + **react-dom 18.3**
- **tailwindcss 3.4** (with `tailwind.config.ts` + `postcss.config.js`; `globals.css` ships `@tailwind` directives)
- **lucide-react 0.460** (icons)
- **framer-motion 11.11** (animations)

If you add or remove a dep here, also update `SANDBOX_CONTEXT_PROMPT` in `packages/role-developer/src/assemble-prompt.ts` so the developer model knows what's actually importable.

## Build + push

```bash
# from this directory
cd packages/sandbox-e2b/templates/atlas-next-ts
export E2B_API_KEY=e2b_...    # your account key
npx @e2b/cli template build
```

The CLI builds the image, pushes it to E2B, and prints the template ID + name. After a successful build:

```
Template ID: <some-alphanumeric-id>
Template Name: atlas-next-ts
```

## Wire into atlas-web

Add to `apps/atlas-web/.env.local`:

```bash
ATLAS_DEFAULT_SANDBOX_TEMPLATE=atlas-next-ts   # OR the printed template ID
ATLAS_DEFAULT_SANDBOX_PORT=3000
```

Restart the Next dev server (`pnpm -F atlas-web dev`). The next time the canvas loads, atlas-web provisions a sandbox from this template and the preview iframe shows your fresh Next.js app.

## Notes

- `start_cmd` in `e2b.toml` is what makes the dev server come up automatically — Dockerfile `CMD` is informational only; E2B overrides it at sandbox boot with `start_cmd`.
- `--hostname 0.0.0.0` is **required**. Without it, Next binds to localhost inside the container and E2B's port forwarding returns "Connection refused on port 3000."
- First sandbox cold-start takes ~5–8s for `pnpm dev` to come up. The factory's preview-URL synthesis happens before that completes; the iframe will retry on its own.
- This template scaffolds a *blank* Next.js app at build time. Atlas's developer role then uses `E2BFileSystem` to write user-generated code into `/code/src/` while the dev server picks it up via HMR.
