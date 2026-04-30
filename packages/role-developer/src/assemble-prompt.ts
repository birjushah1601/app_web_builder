import type { SkillRegistry } from "@atlas/skill-runtime";
import { SkillMissingError } from "./errors.js";

/**
 * Short context block describing the live preview sandbox the developer's
 * diff will be applied to. The current default is a single hardcoded
 * Next.js 14+ template (`atlas-next-ts`), exposing `src/app/page.tsx` as
 * its dev-server entry point. Without this block the model freely emits
 * raw `index.html` files for "static website" intents — which the Next.js
 * dev server inside the sandbox simply doesn't serve, so the iframe
 * preview stays blank.
 *
 * This is the SHORT-TERM fix. The right design (deferred to a follow-up
 * plan) is to (1) add a `runtime` hint to the architect's pass2 artifact,
 * (2) pick the matching E2B template at sandbox-provision time, and (3)
 * pass the resolved runtime down to this prompt so the developer adapts
 * to whatever stack the architect picked. Until then, every diff lands in
 * a Next.js 14+ project.
 */
export const SANDBOX_CONTEXT_PROMPT = [
  "## Target sandbox",
  "",
  "Your diff will be applied to a live Next.js 14+ project (App Router, TypeScript) running in an E2B sandbox (template: atlas-next-ts).",
  "",
  "- The dev-server entry is **`src/app/page.tsx`** — the URL `/` renders whatever this file exports as `default`.",
  "- You may also create new files under `src/app/`, `src/components/`, `src/lib/`, `public/`, or `src/app/globals.css`. The Next dev server hot-reloads these.",
  "- For static-content intents (\"build me a marketing site\", \"build a static website\"), write the markup as a React/JSX `default export` of `src/app/page.tsx`. CSS goes in `src/app/globals.css`, CSS modules, or inline `style={{ ... }}`.",
  "- Do **NOT** write a top-level `index.html` or static HTML files at the project root. The Next dev server will not serve them — the preview iframe will stay blank.",
  "- The template's package.json includes ONLY `next`, `react`, and `react-dom`. The following are **NOT** available — do NOT import them or the dev server fails with `Module not found`:",
  "  - **NO** Tailwind CSS (no @tailwind directives, no `className=\"flex p-4\"` etc.)",
  "  - **NO** lucide-react / heroicons / react-icons (use inline SVG, emoji, or unicode glyphs instead)",
  "  - **NO** framer-motion (use CSS transitions / `@keyframes` if you want animation)",
  "  - **NO** clsx / classnames / shadcn / radix / next/font / next/image extras beyond what next ships",
  "- Style with **inline `style={{ ... }}` objects, plain `<style jsx>` tags, or CSS in `src/app/globals.css`**. That's the safe default.",
  "- If the user explicitly asks for Tailwind / lucide-react / framer-motion, the diff MUST include a `package.json` patch adding the dep AND the config files (tailwind.config.ts + postcss.config.js for Tailwind). Otherwise the imports will 404 at the dev server.",
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
