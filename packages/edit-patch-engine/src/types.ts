/** Discriminated union of every patch the engine can apply.
 *  All patches reference elements by stable atlasId; the captured "old"
 *  fields (oldText, oldUrl, capturedSubtree) exist so each patch's invert()
 *  can produce the reverse without re-reading source. */
export type EditPatch =
  | { kind: "text-replace";      atlasId: string; oldText: string; newText: string }
  | { kind: "style-class-patch"; atlasId: string; addClasses: string[]; removeClasses: string[] }
  | { kind: "asset-swap";        atlasId: string; oldUrl: string; newUrl: string; oldAlt?: string; newAlt?: string }
  | { kind: "dom-mutation";      atlasId: string; op: DomMutationOp; capturedSubtree?: string };

export type DomMutationOp =
  | { kind: "delete" }
  | { kind: "duplicate" }
  | { kind: "wrap"; wrapperTag: string }
  | { kind: "reorder"; direction: "up" | "down" };

/** Result of applying a patch to a single file. */
export interface ApplyPatchResult {
  ok: boolean;
  /** New file content. Undefined when ok=false. */
  newContent?: string;
  /** Inverse patch — pass it back to applyPatch to undo. Undefined when ok=false. */
  inverse?: EditPatch;
  /** Reason for failure. "not-found" means the atlasId wasn't located. */
  error?: "not-found" | "parse-error" | "unsupported";
  /** Human-readable detail for logging / UI. */
  detail?: string;
}
