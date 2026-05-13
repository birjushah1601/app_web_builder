import { applyTextReplace } from "./patches/text-replace.js";
import { applyStyleClass } from "./patches/style-class.js";
import { applyAssetSwap } from "./patches/asset-swap.js";
import { applyDomMutation } from "./patches/dom-mutation.js";
import type { ApplyPatchResult, EditPatch } from "./types.js";

/** Dispatch a patch to the appropriate per-kind applier. */
export function applyPatch(source: string, patch: EditPatch): ApplyPatchResult {
  switch (patch.kind) {
    case "text-replace":      return applyTextReplace(source, patch);
    case "style-class-patch": return applyStyleClass(source, patch);
    case "asset-swap":        return applyAssetSwap(source, patch);
    case "dom-mutation":      return applyDomMutation(source, patch);
  }
}
