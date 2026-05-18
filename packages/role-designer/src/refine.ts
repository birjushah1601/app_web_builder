import { AxisChoiceSchema, type AxisChoice, type DesignDirection } from "./types.js";
import { RefineAxisError } from "./errors.js";

/** Pure mechanical merge — no LLM call. The user already chose `value` via
 *  the AxisWizard; this just folds it into the direction's tokens and
 *  returns a new direction. Throws RefineAxisError on schema mismatch
 *  (e.g. axis name unknown, value outside enum). */
export function refineAxis(direction: DesignDirection, choice: AxisChoice): DesignDirection {
  const parsed = AxisChoiceSchema.safeParse(choice);
  if (!parsed.success) {
    throw new RefineAxisError(`invalid axis choice: ${parsed.error.message}`, { axis: (choice as { axis?: string }).axis ?? "<missing>" });
  }
  const validated = parsed.data;
  return {
    ...direction,
    tokens: {
      ...direction.tokens,
      [validated.axis]: validated.value
    }
  };
}
