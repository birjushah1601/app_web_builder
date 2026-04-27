import type { SandboxFileSystemLike } from "./apply-diff-types";

/** Minimal session shape the adapter needs. We don't pull the full E2B
 *  SandboxSession type because the methods we depend on are stable
 *  across E2B SDK versions and importing the type here would couple
 *  this file to the SDK's internal package layout.
 *
 *  E2B's Sandbox class exposes `readonly files: Filesystem` — NOT `fs`.
 */
interface SandboxSessionLike {
  files: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    remove(path: string): Promise<void>;
  };
}

/** Wrap an E2B Sandbox's `files` methods in the SandboxFileSystemLike
 *  interface that applyDiff consumes. Pure pass-through today;
 *  exists as a seam so future cross-cutting concerns (auditing,
 *  per-write logging, retry) live here, not in apply-diff.ts. */
export function createSandboxFsAdapter(session: SandboxSessionLike): SandboxFileSystemLike {
  return {
    read: (path) => session.files.read(path),
    write: (path, content) => session.files.write(path, content),
    exists: (path) => session.files.exists(path),
    remove: (path) => session.files.remove(path)
  };
}
