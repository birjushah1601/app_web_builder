import type { SandboxId } from "./types.js";
import { SandboxNotFoundError } from "./errors.js";

export interface FileEntry {
  name: string;
  type: "file" | "dir";
  path: string;
}

export interface FileWatchEvent {
  kind: "created" | "modified" | "deleted";
  path: string;
  timestamp: string;
}

export interface SandboxFileSystem {
  read(sandboxId: SandboxId, remotePath: string): Promise<string>;
  write(sandboxId: SandboxId, remotePath: string, content: string): Promise<void>;
  list(sandboxId: SandboxId, remotePath: string): Promise<FileEntry[]>;
  watch(sandboxId: SandboxId, remotePath: string): AsyncIterable<FileWatchEvent>;
}

/** Minimal shape of the SDK filesystem object that E2BFileSystem requires. */
interface SdkFs {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  list(path: string): Promise<FileEntry[]>;
  watchDir?(path: string): AsyncIterable<{ kind: string; path: string }>;
}

interface SdkEntry {
  files: SdkFs;
}

export class E2BFileSystem implements SandboxFileSystem {
  private readonly registry: Map<string, SdkEntry>;

  constructor(registry: Map<string, SdkEntry>) {
    this.registry = registry;
  }

  private sdk(sandboxId: SandboxId): SdkFs {
    const entry = this.registry.get(sandboxId);
    if (!entry) throw new SandboxNotFoundError(sandboxId);
    return entry.files;
  }

  async read(sandboxId: SandboxId, remotePath: string): Promise<string> {
    return this.sdk(sandboxId).read(remotePath);
  }

  async write(sandboxId: SandboxId, remotePath: string, content: string): Promise<void> {
    return this.sdk(sandboxId).write(remotePath, content);
  }

  async list(sandboxId: SandboxId, remotePath: string): Promise<FileEntry[]> {
    return this.sdk(sandboxId).list(remotePath);
  }

  async *watch(sandboxId: SandboxId, remotePath: string): AsyncIterable<FileWatchEvent> {
    const sdk = this.sdk(sandboxId);
    if (!sdk.watchDir) {
      throw new Error(`E2BFileSystem: SDK instance for ${sandboxId} does not support watchDir`);
    }
    for await (const raw of sdk.watchDir(remotePath)) {
      const kind = raw.kind === "created" || raw.kind === "deleted" ? raw.kind : "modified";
      yield { kind: kind as FileWatchEvent["kind"], path: raw.path, timestamp: new Date().toISOString() };
    }
  }
}
