import type { LLMProvider } from "@atlas/llm-provider";
import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import type { SkillRegistry } from "@atlas/skill-runtime";
import { runVisualQualityCheck } from "./visual-quality-check.js";
import type { SandboxExec } from "./screenshot.js";
import type { DesignTokensSnapshot } from "./types.js";

export interface VisualQualityRoleOptions {
  llm: LLMProvider;
  skills: SkillRegistry;
  exec: SandboxExec;
  previewUrl: string;
  model?: string;
}

export class VisualQualityRole implements Role {
  readonly id = "visual-quality";
  private readonly opts: VisualQualityRoleOptions;
  constructor(opts: VisualQualityRoleOptions) {
    this.opts = opts;
  }

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    const reason = shouldSkip(inv.priorArtifact);
    if (reason) {
      events.push({ eventType: "visual_quality.skipped", payload: { reason } });
      events.push({ eventType: "visual_quality.completed", payload: { passed: true, skipped: true } });
      return { events, diff: { kind: "none" } };
    }

    events.push({ eventType: "visual_quality.started", payload: { ritualId: inv.ritualId } });
    const tokens = extractTokens(inv.priorArtifact);

    let report;
    try {
      report = await runVisualQualityCheck({
        llm: this.opts.llm,
        skills: this.opts.skills,
        exec: this.opts.exec,
        previewUrl: this.opts.previewUrl,
        tokens,
        model: this.opts.model
      });
    } catch (err) {
      events.push({ eventType: "visual_quality.errored", payload: { error: (err as Error).message } });
      throw err;
    }

    if (report.passed) {
      events.push({
        eventType: "visual_quality.passed",
        payload: { score: report.score, issueCount: report.issues.length }
      });
    } else {
      const criticalCount = report.issues.filter((i) => i.severity === "critical").length;
      events.push({
        eventType: "visual_quality.failed",
        payload: { critical: criticalCount, total: report.issues.length, issues: report.issues }
      });
    }
    events.push({ eventType: "visual_quality.completed", payload: { passed: report.passed, report } });
    return { events, diff: { kind: "none" } };
  }
}

function shouldSkip(priorArtifact: unknown): string | null {
  if (!priorArtifact || typeof priorArtifact !== "object") return null;
  const manifest = (priorArtifact as { canvasManifest?: unknown }).canvasManifest;
  if (!manifest || typeof manifest !== "object") return null;
  const modes = (manifest as { modes?: Array<{ blockingFor?: string }> }).modes ?? [];
  const hasDesignBlocking = modes.some((m) => m.blockingFor === "design");
  return hasDesignBlocking ? null : "no design-blocking canvas mode in manifest (backend-only or refactor scope)";
}

function extractTokens(priorArtifact: unknown): DesignTokensSnapshot {
  if (!priorArtifact || typeof priorArtifact !== "object") return {};
  const tokens = (priorArtifact as { selectedTokens?: unknown }).selectedTokens;
  if (!tokens || typeof tokens !== "object") return {};
  return tokens as DesignTokensSnapshot;
}
