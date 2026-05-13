import { applyTextReplace } from "./patches/text-replace.js";
import { applyStyleClass } from "./patches/style-class.js";
import { applyAssetSwap } from "./patches/asset-swap.js";
import type { ApplyPatchResult, EditPatch } from "./types.js";

/** Dispatch a patch to the appropriate per-kind applier. Phase 1 implements
 *  text-replace, style-class-patch, asset-swap; dom-mutation lands in Phase 2.
 *  Unknown / not-yet-implemented kinds return ok=false with error="unsupported". */
export function applyPatch(source: string, patch: EditPatch): ApplyPatchResult {
  switch (patch.kind) {
    case "text-replace":      return applyTextReplace(source, patch);
    case "style-class-patch": return applyStyleClass(source, patch);
    case "asset-swap":        return applyAssetSwap(source, patch);
    case "dom-mutation":      return { ok: false, error: "unsupported", detail: "dom-mutation is Phase 2" };
  }
}
