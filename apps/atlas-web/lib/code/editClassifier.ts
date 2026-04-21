import type { EditClass } from "@atlas/ritual-engine";

export interface ClassifyEditInput {
  filePath: string;
  oldContent: string;
  newContent: string;
}

// File extensions that are always treated as structural (config, schema, lock files)
const ALWAYS_STRUCTURAL_EXTS = new Set(["json", "jsonc", "toml", "sql", "lock", "prisma"]);

// Patterns in a diff line that strongly suggest a structural change
const STRUCTURAL_PATTERNS = [
  /^\s*import\s/,           // import statement added/changed
  /^\s*export\s+(function|class|const|type|interface|enum)\s/,  // new export
  /^\s*(function|class|interface|type|enum)\s/,                 // top-level declaration
  /^\s*export\s+default\s/,                                      // default export
];

// Only Tailwind-style class changes (no logic keywords in the diff line)
const COSMETIC_ONLY_PATTERN = /className=["|']([^"']+)["|']/;

function getExtension(filePath: string): string {
  const parts = filePath.split(".");
  if (parts.length < 2) return "";
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Heuristic classifier: returns "structural" when uncertain.
 * Plan G.1 replaces this with the full deterministic edit-tier classifier.
 */
export function classifyEdit(input: ClassifyEditInput): EditClass {
  const { filePath, oldContent, newContent } = input;
  const ext = getExtension(filePath);

  if (ALWAYS_STRUCTURAL_EXTS.has(ext)) return "structural";

  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const linesChanged = Math.abs(newLines.length - oldLines.length);

  if (linesChanged > 50) return "structural";

  // Compute added lines
  const addedLines = newLines.filter((l) => !oldLines.includes(l));

  // Whitespace-only change — strip ALL whitespace and compare tokens
  const oldNorm = oldContent.replace(/\s+/g, "");
  const newNorm = newContent.replace(/\s+/g, "");
  if (oldNorm === newNorm) return "cosmetic";

  for (const line of addedLines) {
    for (const pattern of STRUCTURAL_PATTERNS) {
      if (pattern.test(line)) return "structural";
    }
  }

  // If only className values changed and no structural pattern matched, treat as cosmetic
  const onlyClassChanges =
    addedLines.length > 0 &&
    addedLines.every((l) => COSMETIC_ONLY_PATTERN.test(l) || /^\s*$/.test(l));

  if (onlyClassChanges) return "cosmetic";

  // For markdown, copy changes without code-like patterns are cosmetic
  if (ext === "md" || ext === "mdx") {
    const hasCode = addedLines.some((l) => /^\s{4}|\`/.test(l));
    if (!hasCode) return "cosmetic";
  }

  // Default: structural (conservative)
  return "structural";
}
