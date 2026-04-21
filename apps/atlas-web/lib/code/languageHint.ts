const EXT_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  html: "html",
  htm: "html",
  xml: "xml",
  toml: "ini",
  env: "plaintext",
};

/**
 * Returns a Monaco editor language identifier for the given file path.
 * Falls back to "plaintext" for unknown extensions.
 */
export function languageFromPath(filePath: string): string {
  const parts = filePath.split(".");
  if (parts.length < 2) return "plaintext";
  const ext = parts[parts.length - 1].toLowerCase();
  return EXT_MAP[ext] ?? "plaintext";
}
