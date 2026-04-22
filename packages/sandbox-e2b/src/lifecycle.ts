import { Sandbox } from "@e2b/sdk";
import {
  SandboxIdSchema,
  SandboxRecordSchema,
  type SandboxId,
  type SandboxRecord,
  type TemplateId,
} from "./types.js";
import { SandboxNotFoundError, SandboxProvisionError } from "./errors.js";

export interface SandboxLifecycle {
  provision(templateId: TemplateId, projectId: string): Promise<SandboxRecord>;
  terminate(sandboxId: SandboxId): Promise<void>;
  restart(sandboxId: SandboxId): Promise<SandboxRecord>;
}

/**
 * Records per-sandbox spend after terminate. E2B's billing is time-based;
 * we compute USD as (duration hours × hourlyRateUsd).
 *
 * `@atlas/spec-graph-data`'s `SandboxSpendRepo.record()` satisfies this shape
 * directly — pass the repo to `E2BLifecycle` via `spendRecorder`.
 */
export interface SpendRecorder {
  record(input: { projectId: string; sandboxId: string; usdAmount: number }): Promise<void>;
}

interface E2BLifecycleConfig {
  apiKey: string;
  templateDigests: Record<string, string>;
  /** Optional — when provided, terminate() records duration × hourlyRateUsd. */
  spendRecorder?: SpendRecorder;
  /** USD per hour charged per running sandbox. Default 0.017 (E2B 2-vCPU 4GB baseline). */
  hourlyRateUsd?: number;
}

export class E2BLifecycle implements SandboxLifecycle {
  private readonly config: E2BLifecycleConfig;
  private readonly hourlyRateUsd: number;
  /** In-memory registry: sandboxId → { record, sdkInstance, provisionedAtMs } */
  private readonly registry = new Map<
    SandboxId,
    { record: SandboxRecord; sdk: { kill: () => Promise<void> }; provisionedAtMs: number }
  >();

  constructor(config: E2BLifecycleConfig) {
    this.config = config;
    this.hourlyRateUsd = config.hourlyRateUsd ?? 0.017;
  }

  async provision(templateId: TemplateId, projectId: string): Promise<SandboxRecord> {
    const digest = this.config.templateDigests[templateId];
    let sdk: { sandboxId: string; kill: () => Promise<void> };
    try {
      sdk = await Sandbox.create(templateId, {
        apiKey: this.config.apiKey,
        metadata: { projectId, digest: digest ?? "unpinned" },
      }) as typeof sdk;
    } catch (err) {
      throw new SandboxProvisionError(
        `Failed to provision ${templateId} for project ${projectId}: ${String(err)}`
      );
    }

    const record = SandboxRecordSchema.parse({
      sandboxId: sdk.sandboxId,
      templateId,
      projectId,
      provisionedAt: new Date().toISOString(),
      status: "running" as const,
    });

    this.registry.set(SandboxIdSchema.parse(sdk.sandboxId), {
      record,
      sdk,
      provisionedAtMs: Date.now(),
    });
    return record;
  }

  async terminate(sandboxId: SandboxId): Promise<void> {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    const terminatedAtMs = Date.now();
    await entry.sdk.kill();
    this.registry.set(sandboxId, {
      ...entry,
      record: { ...entry.record, status: "terminated" },
    });
    if (this.config.spendRecorder) {
      const durationHours = Math.max(0, (terminatedAtMs - entry.provisionedAtMs) / 3_600_000);
      const usdAmount = durationHours * this.hourlyRateUsd;
      // Record billable spend — never let a recorder failure mask the terminate.
      try {
        await this.config.spendRecorder.record({
          projectId: entry.record.projectId,
          sandboxId: String(sandboxId),
          usdAmount,
        });
      } catch (err) {
        console.warn(
          `[sandbox-e2b] spend record failed for ${sandboxId} (amount=$${usdAmount.toFixed(4)}): ${String(err)}`
        );
      }
    }
  }

  async restart(sandboxId: SandboxId): Promise<SandboxRecord> {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    await this.terminate(sandboxId);
    return this.provision(entry.record.templateId, entry.record.projectId);
  }
}
