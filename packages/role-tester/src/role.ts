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
  frontendNodeId: string;
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
    const frontendArtifact = upstream[this.opts.frontendNodeId];
    if (!frontendArtifact) {
      events.push({ eventType: "tests.failed", payload: { reason: `missing upstream frontend artifact at "${this.opts.frontendNodeId}"` } });
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
    for (const r of results) targetsBySpec[r.file] = [this.opts.frontendNodeId];

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
