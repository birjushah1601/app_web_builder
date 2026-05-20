import type { PersonaTier } from "@atlas/ritual-engine";
import type { ChecklistItem } from "./checklist.js";

export interface ItemContext {
  graphNodeId: string;
  fieldPath: string;
  rawValue: unknown;
}

export interface ItemView {
  prompt: string;
  detail?: string;
  actions: string[];
  inputKind: "buttons" | "free_text";
}

export function renderItemForPersona(
  item: ChecklistItem,
  persona: PersonaTier,
  ctx: ItemContext
): ItemView {
  if (item.kind === "escape_hatch") {
    return {
      prompt: item.prompt,
      actions: ["Submit", "Skip"],
      inputKind: "free_text"
    };
  }
  switch (persona) {
    case "ama":
      return { prompt: item.prompt, actions: ["Yes", "No", "Ask"], inputKind: "buttons" };
    case "diego":
      return {
        prompt: item.prompt,
        detail: `Affirming ${ctx.graphNodeId} :: ${ctx.fieldPath}`,
        actions: ["Approve", "Reject"],
        inputKind: "buttons"
      };
    case "priya":
      return {
        prompt: item.prompt,
        detail: `${ctx.fieldPath} = ${JSON.stringify(ctx.rawValue)}`,
        actions: ["Approve", "Reject", "View event"],
        inputKind: "buttons"
      };
  }
}
