import { submitPromptedProject } from "./actions";
import { PromptForm } from "./_components/PromptForm";

export default function NewProjectPage() {
  return <PromptForm action={submitPromptedProject} />;
}
