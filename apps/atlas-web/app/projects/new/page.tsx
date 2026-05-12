import { submitPromptedProject } from "./actions";
import { PromptForm } from "./_components/PromptForm";
import { isFeatureEnabledForRequest } from "@/lib/feature-flags-server";

export default async function NewProjectPage() {
  // Plan UXO Task 6 — gate the ReferenceDropZone behind reference-input.
  // Server-side flag read keeps the client bundle free of any flag-source code.
  const referenceInputEnabled = await isFeatureEnabledForRequest("reference-input");
  return (
    <PromptForm
      action={submitPromptedProject}
      referenceInputEnabled={referenceInputEnabled}
    />
  );
}
