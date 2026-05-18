import traverseDefault from "@babel/traverse";
import * as t from "@babel/types";
import type { File } from "@babel/types";

const traverse = (traverseDefault as unknown as { default?: typeof traverseDefault }).default ?? traverseDefault;

/** Find the JSXElement whose opening tag has `data-atlas-id="<id>"`.
 *  Returns null when no match. Walks the entire tree (~O(n) on the file). */
export function locateByAtlasId(ast: File, atlasId: string): t.JSXElement | null {
  let found: t.JSXElement | null = null;
  traverse(ast, {
    JSXOpeningElement(path) {
      if (found) return;
      const idAttr = path.node.attributes.find(
        (a) =>
          t.isJSXAttribute(a) &&
          t.isJSXIdentifier(a.name) &&
          a.name.name === "data-atlas-id"
      );
      if (!idAttr || !t.isJSXAttribute(idAttr)) return;
      const v = idAttr.value;
      if (!t.isStringLiteral(v)) return;
      if (v.value === atlasId) {
        const parent = path.parentPath.node;
        if (t.isJSXElement(parent)) {
          found = parent;
          path.stop();
        }
      }
    }
  });
  return found;
}
