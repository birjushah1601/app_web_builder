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

interface E2BLifecycleConfig {
  apiKey: string;
  templateDigests: Record<string, string>;
}

export class E2BLifecycle implements SandboxLifecycle {
  private readonly config: E2BLifecycleConfig;
  /** In-memory registry: sandboxId → { record, sdkInstance } */
  private readonly registry = new Map<
    SandboxId,
    { record: SandboxRecord; sdk: { kill: () => Promise<void> } }
  >();

  constructor(config: E2BLifecycleConfig) {
    this.config = config;
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

    this.registry.set(SandboxIdSchema.parse(sdk.sandboxId), { record, sdk });
    return record;
  }

  async terminate(sandboxId: SandboxId): Promise<void> {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    await entry.sdk.kill();
    this.registry.set(sandboxId, {
      ...entry,
      record: { ...entry.record, status: "terminated" },
    });
  }

  async restart(sandboxId: SandboxId): Promise<SandboxRecord> {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    await this.terminate(sandboxId);
    return this.provision(entry.record.templateId, entry.record.projectId);
  }
}
