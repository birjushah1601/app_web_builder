"use server";

import { auth } from "@/lib/auth/clerk-compat";
import { getSandboxFactory } from "@/lib/sandbox/factory";
import { applyDiff } from "@/lib/sandbox/apply-diff";
import { createSandboxFsAdapter } from "@/lib/sandbox/sandbox-fs-adapter";
import { tryConsume, type BudgetState } from "@/lib/canvas/edit-ai-budget";

export interface EditElementWithAIInput {
  projectId: string;
  /** Absolute path inside the sandbox, e.g. "/code/src/app/page.tsx" */
  filePath: string;
  atlasId: string;
  instruction: string;
}

export interface EditElementWithAIOutput {
  ok: boolean;
  error?: string;
  budget?: Pick<BudgetState, "used" | "cap" | "remaining" | "warning">;
}

/** Server Action: focused in-place element edit via a single LLM call.
 *  Bypasses the full architect→developer pipeline — no parallel pass, no
 *  reviewer vote. The developer role's focusedRefine branch is invoked
 *  directly with FOCUSED_REFINE_SYSTEM_PROMPT so the diff is scoped to one
 *  element in one file.
 *
 *  Flow:
 *    1. Auth check
 *    2. Read source file from the live E2B sandbox
 *    3. Invoke DeveloperRole.run() with priorArtifact.focusedRefine = true
 *    4. Apply the returned unified diff back into the sandbox
 */
export async function editElementWithAI(
  input: EditElementWithAIInput
): Promise<EditElementWithAIOutput> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "unauthorized" };

  const budget = tryConsume(input.projectId);
  if (budget.exhausted) {
    return {
      ok: false,
      error: `Daily AI edit cap reached (${budget.used}/${budget.cap}). Resets at UTC midnight, or raise ATLAS_EDIT_AI_DAILY_CAP.`,
      budget
    };
  }

  try {
    // 1. Connect to sandbox and read the target source file.
    const session = await getSandboxFactory().getOrProvision(input.projectId);
    const { Sandbox } = await import("@e2b/sdk");
    const sdk = await Sandbox.connect(session.record.sandboxId, {
      apiKey: process.env.E2B_API_KEY ?? ""
    });
    const files = (
      sdk as unknown as {
        files: {
          read: (p: string) => Promise<string>;
          write: (p: string, c: string) => Promise<unknown>;
          exists: (p: string) => Promise<boolean>;
          remove: (p: string) => Promise<void>;
        };
      }
    ).files;

    const sourceSlice = await files.read(input.filePath);

    // 2. Obtain the LLM provider and a minimal SkillRegistry.
    const { getLlmProvider } = await import("@/lib/llm/factory");
    const llm = await getLlmProvider();
    if (!llm) {
      return { ok: false, error: "No LLM provider configured (set ATLAS_LLM_BASE_URL or ANTHROPIC_API_KEY)" };
    }

    const { SkillRegistry } = await import("@atlas/skill-runtime");
    const skills = new SkillRegistry([]);

    // 3. Invoke the developer role's focusedRefine branch.
    const { DeveloperRole } = await import("@atlas/role-developer");
    const role = new DeveloperRole({
      anthropic: llm,
      google: llm,
      reviewer: llm,
      skills,
      anthropicModel: process.env.ATLAS_LLM_DEVELOPER_MODEL
    });

    const targetFile = input.filePath.replace(/^\/code\//, "");
    const output = await role.run({
      ritualId: `fr-${Date.now()}`,
      intent: "developer",
      graphSlice: { bytes: "{}", hash: "sha256:" + "0".repeat(64) },
      userTurn: input.instruction,
      priorArtifact: {
        focusedRefine: true as const,
        targetFile,
        targetAtlasId: input.atlasId,
        sourceSlice
      }
    });

    const diff = output.diff?.body;
    if (!diff || !diff.trim()) {
      return { ok: false, error: "Developer role returned an empty diff" };
    }

    // 4. Apply the diff to the sandbox.
    const fs = createSandboxFsAdapter(sdk as never);
    const applyResult = await applyDiff(fs, diff);
    if (!applyResult.ok) {
      return {
        ok: false,
        error: applyResult.parseError ?? `apply failed (written=${applyResult.written} failed=${applyResult.failed})`
      };
    }

    return { ok: true, budget };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
