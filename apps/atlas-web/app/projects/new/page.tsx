import { submitPromptedProject } from "./actions";
import { PromptForm } from "./_components/PromptForm";
import { PromptFormWithPicker } from "./_components/PromptFormWithPicker";
import { isFeatureEnabledForRequest } from "@/lib/feature-flags-server";

export default async function NewProjectPage() {
  // Plan UXO Task 6 — gate the ReferenceDropZone behind reference-input.
  // Server-side flag read keeps the client bundle free of any flag-source code.
  const referenceInputEnabled = await isFeatureEnabledForRequest("reference-input");

  // Plan G Task 9 — workflow-picker flag selects the classify-first
  // PromptFormWithPicker (renders WorkflowPickerChecklist + cost-cap input);
  // when OFF, today's PromptForm + submitPromptedProject path is preserved.
  const workflowPickerEnabled = await isFeatureEnabledForRequest("workflow-picker");

  if (workflowPickerEnabled) {
    return <PromptFormWithPicker referenceInputEnabled={referenceInputEnabled} />;
  }

  return (
    <PromptForm
      action={submitPromptedProject}
      referenceInputEnabled={referenceInputEnabled}
    />
  );
}
