import ts from "typescript";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import type { AstMapFile, AstRange, NodeAstMapping } from "./types.js";
import { FileBackedAstMapper } from "./mapper.js";

export interface TsCompilerMapperInput {
  /** Absolute path to the project root — everything is resolved relative to this. */
  projectRoot: string;
  /** Stringified spec graph JSON (the mapper reads `nodes` from it). */
  graphJson: string;
  /**
   * Override source-file globs. Defaults to app and components directories with
   * page/route/component file shapes (glob patterns — see the default below).
   */
  sourceGlobs?: string[];
}

interface MinimalGraph {
  nodes: Record<
    string,
    { kind: string; id: string; [k: string]: unknown } & Partial<{ path: string }>
  >;
}

/** Build an AstMapFile by walking the project's TS sources with the TypeScript compiler API. */
export async function buildTsCompilerMap(input: TsCompilerMapperInput): Promise<AstMapFile> {
  const graph = JSON.parse(input.graphJson) as MinimalGraph;
  const graphHash = "sha256:" + createHash("sha256").update(input.graphJson).digest("hex");

  const files = await collectSourceFiles(
    input.projectRoot,
    input.sourceGlobs ?? [
      "app/**/page.tsx",
      "app/**/page.ts",
      "app/**/route.ts",
      "components/**/*.tsx",
      "src/app/**/page.tsx",
      "src/app/**/page.ts",
      "src/app/**/route.ts",
      "src/components/**/*.tsx"
    ]
  );

  const mappings: NodeAstMapping[] = [];

  // Parse each file once, index its exports + the app-router page/route range.
  for (const absPath of files) {
    const source = await readFile(absPath, "utf8");
    const sf = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const relPath = relative(input.projectRoot, absPath).replace(/\\/g, "/");

    // Page mapping: if this file is an App Router page, try to find the corresponding Page node by path.
    const pagePath = pageHrefFromFilePath(relPath);
    if (pagePath !== null) {
      const matchedPage = findPageByHref(graph, pagePath);
      if (matchedPage) {
        mappings.push({
          nodeId: matchedPage.id,
          ranges: [fileWideRange(sf, relPath)],
          confidence: 0.9,
          producer: "ts-compiler@5.6.3"
        });
      }
    }

    // Component mapping: every exported function declaration whose name matches a Component node.
    sf.forEachChild((node) => {
      const exportName = exportedFunctionName(node);
      if (!exportName) return;
      const componentNodeId = `component:${exportName}`;
      if (!graph.nodes[componentNodeId]) return;
      mappings.push({
        nodeId: componentNodeId,
        ranges: [rangeOfNode(sf, node, relPath)],
        confidence: 0.85,
        producer: "ts-compiler@5.6.3"
      });
    });
  }

  // Deduplicate mappings for the same nodeId — keep the first (= highest-confidence) one.
  const seen = new Set<string>();
  const unique = mappings.filter((m) => {
    if (seen.has(m.nodeId)) return false;
    seen.add(m.nodeId);
    return true;
  });

  return {
    version: 1,
    graphHash,
    generatedAt: new Date().toISOString(),
    mappings: unique
  };
}

/** Convenience: build and return a FileBackedAstMapper. */
export async function buildTsCompilerAstMapper(
  input: TsCompilerMapperInput
): Promise<FileBackedAstMapper> {
  const file = await buildTsCompilerMap(input);
  return new FileBackedAstMapper(file);
}

// -----------------------------
// Internals
// -----------------------------

function pageHrefFromFilePath(relPath: string): string | null {
  const prefixes = ["app/", "src/app/"];
  let inner: string | null = null;
  for (const prefix of prefixes) {
    if (!relPath.startsWith(prefix)) continue;
    if (!/(^|\/)page\.(tsx|ts)$/.test(relPath)) continue;
    const afterPrefix = relPath.slice(prefix.length);
    inner = afterPrefix.replace(/(^|\/)page\.(tsx|ts)$/, "");
    break;
  }
  if (inner === null) return null;
  if (inner === "") return "/";
  const cleaned = inner
    .split("/")
    .filter((seg) => seg.length > 0 && !/^\(.+\)$/.test(seg))
    .join("/");
  return cleaned === "" ? "/" : "/" + cleaned;
}

function findPageByHref(graph: MinimalGraph, href: string): { id: string } | null {
  for (const node of Object.values(graph.nodes)) {
    if (node.kind !== "page") continue;
    if (typeof node.path === "string" && node.path === href) return { id: node.id };
  }
  return null;
}

function fileWideRange(sf: ts.SourceFile, relPath: string): AstRange {
  const end = sf.getLineAndCharacterOfPosition(sf.end);
  return {
    file: relPath,
    startLine: 1,
    startColumn: 0,
    endLine: end.line + 1,
    endColumn: end.character
  };
}

function rangeOfNode(sf: ts.SourceFile, node: ts.Node, relPath: string): AstRange {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const end = sf.getLineAndCharacterOfPosition(node.getEnd());
  return {
    file: relPath,
    startLine: start.line + 1,
    startColumn: start.character,
    endLine: end.line + 1,
    endColumn: end.character
  };
}

function exportedFunctionName(node: ts.Node): string | null {
  if (!ts.isFunctionDeclaration(node)) return null;
  const hasExport = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  if (!hasExport) return null;
  return node.name?.getText() ?? null;
}

async function collectSourceFiles(root: string, globs: string[]): Promise<string[]> {
  const results: string[] = [];
  for (const glob of globs) {
    const matched = await walkGlob(root, glob);
    results.push(...matched);
  }
  return [...new Set(results)].sort();
}

async function walkGlob(root: string, glob: string): Promise<string[]> {
  // Accepts only simple globs: segments of literal OR "**" OR "*.ext" OR "*".
  const parts = glob.split("/");
  const out: string[] = [];
  await walk(root, parts, 0, out);
  return out;
}

async function walk(currentDir: string, parts: string[], idx: number, out: string[]): Promise<void> {
  if (idx >= parts.length) return;
  const part = parts[idx]!;
  let entries: Array<{ name: string; isDir: boolean; isFile: boolean }>;
  try {
    const raw = await readdir(currentDir, { withFileTypes: true });
    entries = raw.map((d) => ({ name: d.name, isDir: d.isDirectory(), isFile: d.isFile() }));
  } catch {
    return;
  }
  const isLast = idx === parts.length - 1;

  if (part === "**") {
    // Match zero or more directories: recurse into every subdir AND also try the next pattern at current depth.
    for (const e of entries) {
      const full = join(currentDir, e.name);
      if (e.isDir) {
        await walk(full, parts, idx, out); // stay on "**"
        await walk(full, parts, idx + 1, out); // advance past "**"
      }
    }
    // Also allow ** to match zero segments.
    await walk(currentDir, parts, idx + 1, out);
    return;
  }

  const regex = globPartToRegex(part);
  for (const e of entries) {
    if (!regex.test(e.name)) continue;
    const full = join(currentDir, e.name);
    if (isLast) {
      if (e.isFile) {
        out.push(full);
      }
    } else if (e.isDir) {
      await walk(full, parts, idx + 1, out);
    }
  }
}

function globPartToRegex(part: string): RegExp {
  // Translate "*.ext" or "*" into a regex — literal dots get escaped, "*" becomes ".*".
  const escaped = part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

// Re-export so test/factory callers can inspect paths.
export const _internal = { pageHrefFromFilePath, globPartToRegex };

// Silence the "stat" unused-import warning some tsconfigs emit.
void stat;
