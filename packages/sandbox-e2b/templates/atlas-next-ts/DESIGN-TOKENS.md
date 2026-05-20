# Design Tokens Contract (atlas-next-ts-v2)

`src/design-tokens.json` is the single source of truth for the sandbox's
visual identity. The Designer role produces a direction; the Developer role
writes those values into this file; Tailwind + a small `<style>` tag in
`layout.tsx` pick them up automatically on the next HMR tick.

## Schema

```json
{
  "palette": {
    "primary":    "#hex",
    "secondary":  "#hex",
    "accent":     "#hex",
    "muted":      "#hex",
    "background": "#hex",
    "foreground": "#hex"
  },
  "typography": {
    "headingFont":  "Inter",
    "bodyFont":     "Inter",
    "headingScale": "1.25"
  },
  "radius":  { "base":    "0.5rem" },
  "spacing": { "section": "5rem"   }
}
```

All fields are required by the schema but tolerated as missing at runtime —
both `tailwind.config.ts` and `design-tokens-style.tsx` merge against an
inline default (slate/blue + Inter + 0.5rem). A partial file will not crash
the build; missing keys silently fall back.

## How the Developer role updates it

**Always rewrite the whole file.** Never emit a partial diff against this
JSON. The Designer's chosen direction provides every key — re-emit the entire
object verbatim:

```diff
diff --git a/src/design-tokens.json b/src/design-tokens.json
new file mode 100644
--- /dev/null
+++ b/src/design-tokens.json
@@ -0,0 +1,N @@
+{
+  "palette": { ... },
+  ...
+}
```

The `new file mode 100644 / --- /dev/null` pattern is the same one the
sandbox uses for every file the developer "owns" — it sidesteps line-number
drift in the existing file.

## How the runtime picks it up

1. **Tailwind utilities** — `tailwind.config.ts` does
   `import tokens from "./src/design-tokens.json"` (TypeScript's
   `resolveJsonModule` is on in `tsconfig.json`). On any change, Next/Tailwind
   rebuilds the utility CSS, so `bg-primary`, `text-foreground`,
   `border-accent`, `font-heading`, `rounded` etc. all reflect the new values.
2. **CSS custom properties** — `src/app/design-tokens-style.tsx` imports the
   same JSON and renders a `<style data-atlas-design-tokens>` tag inside
   `<head>` exposing `--color-primary`, `--font-heading`, `--radius-base`,
   `--spacing-section`, etc. Use these for one-off inline styles where no
   utility class exists.

Both paths share the JSON, so they can never drift out of sync.

## Republishing the template

Editing the JSON inside a running sandbox works without a republish — the
file is mutable at `/code/src/design-tokens.json` and Next's HMR re-imports
it. **Republish only when the schema itself changes** (new keys, renamed
keys, etc.), since that requires the baked-in defaults in
`tailwind.config.ts` and `design-tokens-style.tsx` to be updated too:

```bash
cd packages/sandbox-e2b/templates/atlas-next-ts
export E2B_API_KEY=e2b_...
./scripts/build-template.sh
```
