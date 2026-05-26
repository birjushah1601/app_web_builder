// packages/eval-runtime/src/cli/run.ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EvalCaseSchema, type EvalCase } from "../types.js";
import type { Rubric } from "../rubric.js";

interface RunOpts {
  role?: string;
  rubricRegistry: Record<string, Rubric<unknown>>;
  llm: any;
  casesDir?: string;
}

export async function runReplay(args: string[], opts?: Partial<RunOpts>): Promise<void> {
  const roleArg = parseArg(args, "--role");
  const casesDir =
    opts?.casesDir ??
    join(fileURLToPath(import.meta.url), "..", "..", "..", "cases");

  const rubricRegistry = opts?.rubricRegistry ?? {};
  const llm = opts?.llm;
  if (!llm) {
    throw new Error(
      "runReplay requires an LLM provider (inject via opts.llm or set ATLAS_LLM_BASE_URL + ATLAS_LLM_API_KEY)"
    );
  }

  const roleIds = roleArg ? [roleArg] : Object.keys(rubricRegistry);
  let totalPassed = 0,
    totalRegressed = 0,
    totalFixed = 0,
    totalCases = 0;

  for (const roleId of roleIds) {
    const rubric = rubricRegistry[roleId];
    if (!rubric) {
      console.warn(`No rubric registered for role "${roleId}", skipping`);
      continue;
    }
    const dir = join(casesDir, roleId);
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      console.warn(`No cases dir for ${roleId} at ${dir}`);
      continue;
    }

    if (files.length === 0) {
      console.warn(`No case files found for role "${roleId}" in ${dir}`);
      continue;
    }

    for (const file of files) {
      const raw = await readFile(join(dir, file), "utf-8");
      let parsed: EvalCase;
      try {
        parsed = EvalCaseSchema.parse(JSON.parse(raw));
      } catch (err) {
        console.error(`Invalid case ${file}:`, err);
        continue;
      }
      if (parsed.rubricVersion !== rubric.version) {
        console.warn(
          `Case ${file} pinned to ${parsed.rubricVersion}, current is ${rubric.version}; running anyway`
        );
      }
      totalCases++;
      const structural = rubric.structural(parsed.output, {
        userTurn: parsed.inputs.userTurn,
      } as any);
      let actualPassed = structural.passed;
      let actualScore: number | undefined;
      if (structural.passed) {
        const judge = await rubric.judge(
          parsed.output,
          { userTurn: parsed.inputs.userTurn } as any,
          llm
        );
        actualPassed = judge.passed;
        actualScore = judge.score;
      }
      const expectedPassed = parsed.expected.passed;
      if (actualPassed === expectedPassed) {
        if (actualPassed) totalPassed++;
      } else if (expectedPassed && !actualPassed) {
        totalRegressed++;
        console.error(`REGRESSED: ${file} (was passing, now failing)`);
      } else {
        totalFixed++;
        console.log(`FIXED: ${file} (was failing, now passing)`);
      }
      void actualScore;
    }
  }

  console.log(
    `\n=== Results ===\nTotal: ${totalCases}, Passed: ${totalPassed}, Regressed: ${totalRegressed}, Fixed: ${totalFixed}`
  );
  if (totalRegressed > 0) {
    process.exit(1);
  }
}

function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}
