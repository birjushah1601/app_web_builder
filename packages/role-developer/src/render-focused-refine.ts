export interface FocusedRefineInput {
  instruction: string;
  targetFile: string;
  targetAtlasId: string;
  sourceSlice: string;
}

/** Build the user-turn message for a focused-refine developer dispatch.
 *  Differs from renderDeveloperUserTurn in scope: this targets ONE element,
 *  not the whole page. The system-prompt fragment (in
 *  FOCUSED_REFINE_SYSTEM_PROMPT) reinforces the "don't regenerate the page"
 *  constraint; this user-turn supplies the surgical context. */
export function renderFocusedRefineUserTurn(input: FocusedRefineInput): string {
  return [
    `# Focused refine — Edit ONLY this element`,
    ``,
    `## Instruction (from the user, in plain English)`,
    input.instruction,
    ``,
    `## Target`,
    `- File: \`${input.targetFile}\``,
    `- Element atlasId: \`${input.targetAtlasId}\``,
    ``,
    `## Current source (the JSX subtree to edit, plus a few lines of context)`,
    "```tsx",
    input.sourceSlice,
    "```",
    ``,
    `## Rules`,
    `- Return a unified diff that touches ONLY this file.`,
    `- Modify ONLY the JSX subtree whose opening element has \`data-atlas-id="${input.targetAtlasId}"\`. Do NOT restructure surrounding sections.`,
    `- Preserve all existing \`data-atlas-id\` attributes on elements you keep.`,
    `- Add new \`data-atlas-id\` attributes only when introducing brand-new JSX elements; otherwise leave existing IDs alone.`,
    `- Keep Tailwind classes, design tokens, and import statements consistent with the rest of the file.`,
    `- Do not regenerate the page. If the instruction is ambiguous, prefer the smaller, safer change.`
  ].join("\n");
}

export const FOCUSED_REFINE_SYSTEM_PROMPT = [
  "You are a focused refine pass. The user has selected ONE element on the page and described a change.",
  "Your job is to return the smallest possible unified diff that:",
  "  - Touches only the named file.",
  "  - Modifies only the JSX subtree marked with the given data-atlas-id.",
  "  - Preserves all unrelated code byte-for-byte.",
  "Do NOT regenerate the page. Do NOT touch other sections. Do NOT remove existing data-atlas-id attributes."
].join(" ");
