import type { Role, RoleInvocation, RoleOutput } from "@atlas/conductor";
import { TestsArtifactSchema } from "@atlas/workflow-engine";
import { parseVitestJson } from "./parse-vitest-json.js";
import { buildTestsArtifact } from "./build-artifact.js";

export interface SandboxLike {
  exec(cmd: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  write(path: string, contents: string): Promise<void>;
}

export interface TestsRoleOptions {
  sandbox: SandboxLike;
  generateTests: (input: { frontendArtifact: unknown; ritualId: string }) => Promise<Record<string, string>>;
  /** Optional. When unset, the role walks `priorArtifact.upstream` and
   *  picks the first entry whose value has `kind === "frontend-app"`.
   *  This is the path the atlas-web factory takes — the workflow-engine
   *  picks the node id, so the factory shouldn't have to guess it. */
  frontendNodeId?: string;
  installCmd?: string;
  runCmd?: string;
}

const DEFAULT_INSTALL = "pnpm add -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom";
const DEFAULT_RUN = "pnpm exec vitest run --reporter=json";

export class TestsRole implements Role {
  readonly id = "tester";

  constructor(private readonly opts: TestsRoleOptions) {}

  async run(inv: RoleInvocation): Promise<RoleOutput> {
    const events: RoleOutput["events"] = [];
    const upstream = (inv.priorArtifact as { upstream?: Record<string, unknown> } | undefined)?.upstream ?? {};

    // Resolve the upstream frontend artifact + its node-id. Two paths:
    //   (a) caller provided frontendNodeId at construction — look it up directly
    //   (b) caller omitted it — auto-detect by walking upstream entries and
    //       picking the first whose value has `kind === "frontend-app"`.
    // (b) is the path atlas-web's factory takes: the workflow planner picks
    // the node id, so the factory can't know it in advance.
    let resolvedFrontendNodeId: string | undefined;
    let frontendArtifact: unknown;
    if (this.opts.frontendNodeId !== undefined) {
      resolvedFrontendNodeId = this.opts.frontendNodeId;
      frontendArtifact = upstream[this.opts.frontendNodeId];
    } else {
      for (const [id, art] of Object.entries(upstream)) {
        if (art && typeof art === "object" && (art as { kind?: unknown }).kind === "frontend-app") {
          resolvedFrontendNodeId = id;
          frontendArtifact = art;
          break;
        }
      }
    }
    if (!frontendArtifact || !resolvedFrontendNodeId) {
      const reason = this.opts.frontendNodeId !== undefined
        ? `missing upstream frontend artifact at "${this.opts.frontendNodeId}"`
        : `no upstream artifact with kind="frontend-app" found`;
      events.push({ eventType: "tests.failed", payload: { reason } });
      return { events, diff: { kind: "none" } };
    }

    const install = await this.opts.sandbox.exec(this.opts.installCmd ?? DEFAULT_INSTALL);
    if (install.exitCode !== 0) {
      events.push({ eventType: "tests.failed", payload: { reason: `runner install failed: ${install.stderr.slice(0, 500)}` } });
      return { events, diff: { kind: "none" } };
    }

    let generated: Record<string, string>;
    try {
      generated = await this.opts.generateTests({ frontendArtifact, ritualId: inv.ritualId });
    } catch (err) {
      events.push({ eventType: "tests.failed", payload: { reason: `LLM generate failed: ${err instanceof Error ? err.message : String(err)}` } });
      return { events, diff: { kind: "none" } };
    }

    for (const [path, contents] of Object.entries(generated)) {
      await this.opts.sandbox.write(path, contents);
    }

    const runResult = await this.opts.sandbox.exec(this.opts.runCmd ?? DEFAULT_RUN);
    const results = parseVitestJson(runResult.stdout);

    if (results.length === 0 && runResult.exitCode !== 0) {
      events.push({ eventType: "tests.failed", payload: { reason: `runner failed without parseable output: exit=${runResult.exitCode} stderr=${runResult.stderr.slice(0, 500)}` } });
      return { events, diff: { kind: "none" } };
    }

    const targetsBySpec: Record<string, string[]> = {};
    for (const r of results) targetsBySpec[r.file] = [resolvedFrontendNodeId];

    const artifact = buildTestsArtifact({ framework: "vitest", results, targetsBySpec });
    const parsed = TestsArtifactSchema.safeParse(artifact);
    if (!parsed.success) {
      events.push({ eventType: "tests.failed", payload: { reason: `artifact failed schema validation: ${parsed.error.message}` } });
      return { events, diff: { kind: "none" } };
    }

    events.push({ eventType: "ritual.artifact_emitted", payload: { fromRole: "tester", artifact: parsed.data } });
    return { events, diff: { kind: "none" } };
  }
}
