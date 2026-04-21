import type { SandboxId } from "./types.js";
import { SandboxNotFoundError } from "./errors.js";

export interface SandboxPreview {
  /** Returns the full HTTPS URL that proxies to the sandbox's HTTP server on `port`. */
  getPreviewUrl(sandboxId: SandboxId, port: number): string;
}

interface SdkHostProvider {
  getHost(port: number): string;
}

export class E2BPreview implements SandboxPreview {
  private readonly registry: Map<string, SdkHostProvider>;

  constructor(registry: Map<string, SdkHostProvider>) {
    this.registry = registry;
  }

  getPreviewUrl(sandboxId: SandboxId, port: number): string {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    const host = entry.getHost(port);
    return `https://${host}`;
  }
}
