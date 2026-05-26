// src/feedback.ts
import type { StructuralResult, JudgeResult, EvalFeedback } from "./types.js";

export function formatStructuralFeedback(result: StructuralResult): EvalFeedback {
  if (result.passed) {
    throw new Error("formatStructuralFeedback called on passed result");
  }
  const lines = result.failures.map((f) => `- ${f.check}: ${f.reason}`);
  return {
    source: "structural",
    promptFragment:
      `## Previous-attempt feedback\nYour previous output failed these structural checks:\n${lines.join("\n")}\nAddress each point. Do not repeat the same gap.`,
    failures: result.failures
  };
}

export function formatJudgeFeedback(
  result: JudgeResult,
  opts: { passThreshold: number }
): EvalFeedback {
  const failed = result.dimensions.filter((d) => d.score < opts.passThreshold);
  const lines = failed.map(
    (d) => `- ${d.name} (${d.score}/10): ${d.rationale}`
  );
  const tail = result.feedback ? `\n\nJudge guidance: ${result.feedback}` : "";
  return {
    source: "judge",
    promptFragment:
      `## Previous-attempt feedback\nYour previous output failed these quality dimensions:\n${lines.join("\n")}${tail}\nAddress each dimension. Do not repeat the same gap.`,
    dimensions: failed
  };
}

export function shouldRetry(
  structural: StructuralResult,
  judge: JudgeResult | null,
  qualityAttempt: number
): boolean {
  if (qualityAttempt >= 2) return false;
  if (!structural.passed) return true;
  if (judge && !judge.passed && judge.fixableBy === "retry") return true;
  return false;
}
