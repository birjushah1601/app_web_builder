import type { SkillRegistry } from "@atlas/skill-runtime";
import { SkillMissingError } from "./errors.js";

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
  "- If a layout truly lacks a Tailwind utility for what you need, inline `style={{ ... }}` is acceptable but rare.",
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

export function assembleDeveloperPrompt(registry: SkillRegistry, skillNames: string[]): string {
  const sections: string[] = [];
  for (const name of skillNames) {
    const skill = registry.get(name);
    if (!skill) throw new SkillMissingError(name);
    sections.push(`## Skill: ${name}\n\n${skill.body.trim()}\n`);
  }
  return sections.join("\n---\n\n");
}
