#!/usr/bin/env node
// packages/eval-runtime/src/cli/index.ts
//
// CLI entry point for the `evals` tool.
// Rubrics: imports architectRubric + developerRubric directly (approach a — simple, v1 only has two roles).
// LLM: reads ATLAS_LLM_BASE_URL + ATLAS_LLM_API_KEY env vars and constructs a thin
//      fetch-based client that satisfies the minimal interface runReplay needs.

import { architectRubric } from "@atlas/role-architect";
import { developerRubric } from "@atlas/role-developer";
import type { Rubric } from "../rubric.js";
import { runReplay } from "./run.js";
import { buildDataset } from "./build-dataset.js";

// ---------------------------------------------------------------------------
// Rubric registry — add new roles here when their packages land.
// ---------------------------------------------------------------------------
const rubricRegistry: Record<string, Rubric<unknown>> = {
  [architectRubric.roleId]: architectRubric as Rubric<unknown>,
  [developerRubric.roleId]: developerRubric as Rubric<unknown>,
};

// ---------------------------------------------------------------------------
// Minimal LLM client for CLI use.
// Satisfies the `completeWithToolUse` shape expected by rubric judge() methods.
// Not production-grade — good enough for offline replay.
// ---------------------------------------------------------------------------
function buildCliLlm() {
  const baseUrl =
    process.env["ATLAS_LLM_BASE_URL"] ?? "https://api.openai.com/v1";
  const apiKey = process.env["ATLAS_LLM_API_KEY"] ?? "";

  return {
    async completeWithToolUse(params: {
      model: string;
      system: string;
      messages: Array<{ role: string; content: string }>;
      tools: Array<{ name: string; description: string; input_schema: unknown }>;
      max_tokens?: number;
    }): Promise<{ toolUse: { name: string; input: unknown } | null }> {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          messages: [
            { role: "system", content: params.system },
            ...params.messages,
          ],
          tools: params.tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
            },
          })),
          tool_choice: "required",
          max_tokens: params.max_tokens ?? 1024,
        }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`LLM request failed (${resp.status}): ${body}`);
      }

      const data = (await resp.json()) as {
        choices: Array<{
          message: {
            tool_calls?: Array<{
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };

      const toolCall = data.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall) return { toolUse: null };
      return {
        toolUse: {
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments),
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "run":
      await runReplay(rest, {
        rubricRegistry,
        llm: buildCliLlm(),
      });
      break;
    case "build-dataset":
      await buildDataset(rest);
      break;
    default:
      console.error(`Usage: evals <run|build-dataset> [options]`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
