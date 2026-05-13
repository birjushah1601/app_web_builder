import { parse } from "@babel/parser";
import generateDefault from "@babel/generator";
import * as t from "@babel/types";
import { locateByAtlasId } from "../locate.js";
import type { ApplyPatchResult, EditPatch } from "../types.js";

const generate = (generateDefault as unknown as { default?: typeof generateDefault }).default ?? generateDefault;

function setStringAttr(opening: t.JSXOpeningElement, name: string, value: string) {
  const existing = opening.attributes.find(
    (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === name
  );
  if (existing && t.isJSXAttribute(existing)) {
    existing.value = t.stringLiteral(value);
  } else {
    opening.attributes.push(t.jsxAttribute(t.jsxIdentifier(name), t.stringLiteral(value)));
  }
}

export function applyAssetSwap(
  source: string,
  patch: Extract<EditPatch, { kind: "asset-swap" }>
): ApplyPatchResult {
  let ast;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (err) {
    return { ok: false, error: "parse-error", detail: err instanceof Error ? err.message : String(err) };
  }

  const node = locateByAtlasId(ast, patch.atlasId);
  if (!node) return { ok: false, error: "not-found", detail: `atlasId=${patch.atlasId}` };

  setStringAttr(node.openingElement, "src", patch.newUrl);
  if (patch.newAlt !== undefined) {
    setStringAttr(node.openingElement, "alt", patch.newAlt);
  }

  const out = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source);
  const inverse: EditPatch = {
    kind: "asset-swap",
    atlasId: patch.atlasId,
    oldUrl: patch.newUrl,
    newUrl: patch.oldUrl,
    ...(patch.newAlt !== undefined ? { oldAlt: patch.newAlt } : {}),
    ...(patch.oldAlt !== undefined ? { newAlt: patch.oldAlt } : {})
  };
  return { ok: true, newContent: out.code, inverse };
}
