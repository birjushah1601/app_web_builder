import { parse } from "@babel/parser";
import generateDefault from "@babel/generator";
import * as t from "@babel/types";
import { locateByAtlasId } from "../locate.js";
import type { ApplyPatchResult, EditPatch } from "../types.js";

const generate = (generateDefault as unknown as { default?: typeof generateDefault }).default ?? generateDefault;

export function applyStyleClass(
  source: string,
  patch: Extract<EditPatch, { kind: "style-class-patch" }>
): ApplyPatchResult {
  let ast;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (err) {
    return { ok: false, error: "parse-error", detail: err instanceof Error ? err.message : String(err) };
  }

  const node = locateByAtlasId(ast, patch.atlasId);
  if (!node) return { ok: false, error: "not-found", detail: `atlasId=${patch.atlasId}` };

  const opening = node.openingElement;
  const classAttr = opening.attributes.find(
    (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === "className"
  );

  // Parse existing className value into a Set of tokens.
  const existing: string[] = [];
  if (classAttr && t.isJSXAttribute(classAttr) && classAttr.value) {
    if (t.isStringLiteral(classAttr.value)) {
      existing.push(...classAttr.value.value.split(/\s+/).filter(Boolean));
    }
    // Note: className={someExpression} is preserved unchanged — we can't
    // safely diff dynamic class strings; surface as unsupported.
    else {
      return { ok: false, error: "unsupported", detail: "className is a dynamic expression — use ai-rewrite" };
    }
  }

  const next = new Set(existing);
  for (const c of patch.removeClasses) next.delete(c);
  for (const c of patch.addClasses) next.add(c);
  const nextValue = Array.from(next).join(" ");

  if (classAttr && t.isJSXAttribute(classAttr)) {
    classAttr.value = t.stringLiteral(nextValue);
  } else {
    opening.attributes.push(t.jsxAttribute(t.jsxIdentifier("className"), t.stringLiteral(nextValue)));
  }

  const out = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source);
  return {
    ok: true,
    newContent: out.code,
    inverse: {
      kind: "style-class-patch",
      atlasId: patch.atlasId,
      addClasses: patch.removeClasses,
      removeClasses: patch.addClasses
    }
  };
}
