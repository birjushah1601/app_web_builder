import { parse } from "@babel/parser";
import traverseDefault from "@babel/traverse";
import generateDefault from "@babel/generator";
import * as t from "@babel/types";
import { createHash } from "node:crypto";

// Babel's default-exports get wrapped one extra time when imported via ESM.
const traverse = (traverseDefault as unknown as { default?: typeof traverseDefault }).default ?? traverseDefault;
const generate = (generateDefault as unknown as { default?: typeof generateDefault }).default ?? generateDefault;

/** Compute a stable 12-char hex hash for an element at a given offset in a file.
 *  Stability properties:
 *    - Same (filePath, nodeStart) → same id. ✓
 *    - Whitespace-only changes elsewhere in the file don't shift nodeStart for
 *      this element (Babel uses original-source offsets). ✓
 *    - Structural inserts BEFORE this element shift nodeStart and produce a
 *      different id. ✗ — acceptable: the element has effectively moved. */
function computeAtlasId(filePath: string, nodeStart: number): string {
  return createHash("sha1").update(`${filePath}:${nodeStart}`).digest("hex").slice(0, 12);
}

/** Annotate every JSXOpeningElement that lacks `data-atlas-id` with a
 *  computed stable id. Returns the regenerated source. On parse error,
 *  returns the input unchanged (caller's diff still lands; just no
 *  fast-path editing on this file until a later write re-annotates). */
export function annotateAtlasIds(filePath: string, source: string): string {
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: false
    });
  } catch {
    return source;
  }

  let mutated = false;
  traverse(ast, {
    JSXOpeningElement(path) {
      const node = path.node;
      const hasAtlasId = node.attributes.some(
        (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === "data-atlas-id"
      );
      if (hasAtlasId) return;
      const start = node.start ?? 0;
      const id = computeAtlasId(filePath, start);
      node.attributes.push(
        t.jsxAttribute(t.jsxIdentifier("data-atlas-id"), t.stringLiteral(id))
      );
      mutated = true;
    }
  });

  if (!mutated) return source;
  const result = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source);
  return result.code;
}
