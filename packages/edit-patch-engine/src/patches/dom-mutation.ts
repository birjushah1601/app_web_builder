import { parse } from "@babel/parser";
import generateDefault from "@babel/generator";
import * as t from "@babel/types";
import { locateByAtlasId } from "../locate.js";
import type { ApplyPatchResult, EditPatch, DomMutationOp } from "../types.js";

const generate = (generateDefault as unknown as { default?: typeof generateDefault }).default ?? generateDefault;

function nodeToString(node: t.JSXElement): string {
  return generate(node, { jsescOption: { minimal: true } }).code;
}

export function applyDomMutation(
  source: string,
  patch: Extract<EditPatch, { kind: "dom-mutation" }>
): ApplyPatchResult {
  let ast;
  try {
    ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (err) {
    return { ok: false, error: "parse-error", detail: err instanceof Error ? err.message : String(err) };
  }
  const node = locateByAtlasId(ast, patch.atlasId);
  if (!node) return { ok: false, error: "not-found", detail: `atlasId=${patch.atlasId}` };

  // Find the parent JSXElement / JSXFragment + the index of `node` in its children.
  // We use Babel traverse to walk and locate (paths give us parent access).
  // For Phase 2 simplicity, only operate when parent is a JSXElement with a
  // children array we can mutate.
  let parent: t.JSXElement | t.JSXFragment | null = null;
  let indexInParent = -1;
  (function findParent() {
    const stack: Array<t.Node> = [ast];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if ((t.isJSXElement(n) || t.isJSXFragment(n)) && Array.isArray(n.children)) {
        const idx = n.children.indexOf(node);
        if (idx >= 0) { parent = n; indexInParent = idx; return; }
        for (const c of n.children) stack.push(c);
      }
      for (const key of Object.keys(n)) {
        const v = (n as unknown as Record<string, unknown>)[key];
        if (Array.isArray(v)) {
          for (const item of v) {
            if (item && typeof item === "object" && "type" in (item as object)) stack.push(item as t.Node);
          }
        } else if (v && typeof v === "object" && "type" in (v as object)) {
          stack.push(v as t.Node);
        }
      }
    }
  })();

  if (!parent || indexInParent < 0) {
    return { ok: false, error: "unsupported", detail: "parent JSX node not found" };
  }

  const captured = nodeToString(node);

  switch (patch.op.kind) {
    case "delete":
      parent.children.splice(indexInParent, 1);
      break;
    case "duplicate": {
      const clone = JSON.parse(JSON.stringify(node)) as t.JSXElement;
      parent.children.splice(indexInParent + 1, 0, clone);
      break;
    }
    case "wrap": {
      const wrapper = t.jsxElement(
        t.jsxOpeningElement(t.jsxIdentifier(patch.op.wrapperTag), []),
        t.jsxClosingElement(t.jsxIdentifier(patch.op.wrapperTag)),
        [node],
        false
      );
      parent.children.splice(indexInParent, 1, wrapper);
      break;
    }
    case "reorder": {
      const swap = patch.op.direction === "up" ? indexInParent - 1 : indexInParent + 1;
      if (swap < 0 || swap >= parent.children.length) {
        return { ok: false, error: "unsupported", detail: "cannot reorder at boundary" };
      }
      [parent.children[indexInParent], parent.children[swap]] =
        [parent.children[swap]!, parent.children[indexInParent]!];
      break;
    }
  }

  const out = generate(ast, { retainLines: true, jsescOption: { minimal: true } }, source);

  // Invert: delete ↔ insert(captured), duplicate ↔ delete, wrap ↔ unwrap (we
  // implement only the duplicate-inverse-of-delete case fully in Phase 2.
  // wrap/reorder invert are best-effort; the captured subtree is the universal
  // recovery payload).
  const invertOp: DomMutationOp =
    patch.op.kind === "delete" ? { kind: "duplicate" } :
    patch.op.kind === "duplicate" ? { kind: "delete" } :
    patch.op.kind === "reorder" ? { kind: "reorder", direction: patch.op.direction === "up" ? "down" : "up" } :
    patch.op; // wrap inverse is captured-subtree-based; engine v2 will refine

  return {
    ok: true,
    newContent: out.code,
    inverse: { kind: "dom-mutation", atlasId: patch.atlasId, op: invertOp, capturedSubtree: captured }
  };
}
