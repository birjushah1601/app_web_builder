import { parse } from "@babel/parser";
import generateDefault from "@babel/generator";
import * as t from "@babel/types";
import { locateByAtlasId } from "../locate.js";
import type { ApplyPatchResult, EditPatch } from "../types.js";

const generate = (generateDefault as unknown as { default?: typeof generateDefault }).default ?? generateDefault;

/** Depth-first search for the first <img> JSXElement under `child`. */
function findImgIn(child: t.Node): t.JSXElement | null {
  if (t.isJSXElement(child)) {
    if (
      t.isJSXIdentifier(child.openingElement.name) &&
      child.openingElement.name.name === "img"
    ) {
      return child;
    }
    for (const grand of child.children) {
      const found = findImgIn(grand);
      if (found) return found;
    }
  }
  return null;
}

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

  // Find the actual <img> tag. The atlas-id frequently sits on a wrapper
  // (<picture>, <a href>, an aspect-ratio div) because the annotator stamps
  // every JSXOpeningElement and the wrapper is encountered first. Setting
  // `src` on a wrapper does nothing visually and just litters the JSX with
  // useless attributes. If the located element isn't an <img>, walk its
  // descendants to find one.
  let imgNode: t.JSXElement | null = null;
  if (
    t.isJSXIdentifier(node.openingElement.name) &&
    node.openingElement.name.name === "img"
  ) {
    imgNode = node;
  } else {
    for (const child of node.children) {
      if (imgNode) break;
      const found = findImgIn(child);
      if (found) imgNode = found;
    }
  }
  if (!imgNode) {
    return { ok: false, error: "not-found", detail: `no <img> at atlasId=${patch.atlasId}` };
  }

  setStringAttr(imgNode.openingElement, "src", patch.newUrl);
  if (patch.newAlt !== undefined) {
    setStringAttr(imgNode.openingElement, "alt", patch.newAlt);
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
