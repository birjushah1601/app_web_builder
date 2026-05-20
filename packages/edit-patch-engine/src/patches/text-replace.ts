import { parse } from "@babel/parser";
import generateDefault from "@babel/generator";
import * as t from "@babel/types";
import { locateByAtlasId } from "../locate.js";
import type { ApplyPatchResult, EditPatch } from "../types.js";

const generate = (generateDefault as unknown as { default?: typeof generateDefault }).default ?? generateDefault;

export function applyTextReplace(
  source: string,
  patch: Extract<EditPatch, { kind: "text-replace" }>
): ApplyPatchResult {
  let ast;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (err) {
    return { ok: false, error: "parse-error", detail: err instanceof Error ? err.message : String(err) };
  }

  const node = locateByAtlasId(ast, patch.atlasId);
  if (!node) return { ok: false, error: "not-found", detail: `atlasId=${patch.atlasId}` };

  // Replace the children with a single JSXText carrying the new text.
  // Loses any nested elements — text-replace is for leaf text nodes only.
  // The caller should refuse text-replace when the element has element children
  // and route those edits through ai-rewrite instead.
  node.children = [t.jsxText(patch.newText)];

  const out = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source);
  return {
    ok: true,
    newContent: out.code,
    inverse: {
      kind: "text-replace",
      atlasId: patch.atlasId,
      oldText: patch.newText,
      newText: patch.oldText
    }
  };
}
