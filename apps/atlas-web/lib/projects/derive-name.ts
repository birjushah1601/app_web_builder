// apps/atlas-web/lib/projects/derive-name.ts
const LEADING_FILLERS = new Set([
  "make", "me", "build", "create", "design",
  "a", "an", "the", "for", "my",
  "of", "and", "or", "to", "that"
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
