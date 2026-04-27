import type { SandboxFileSystemLike } from "./apply-diff-types";

/** Minimal session shape the adapter needs. We don't pull the full E2B
 *  SandboxSession type because the methods we depend on are stable
 *  across E2B SDK versions and importing the type here would couple
 *  this file to the SDK's internal package layout. */
interface SandboxSessionLike {
  fs: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    remove(path: string): Promise<void>;
  };
}

/** Wrap a SandboxSession's fs methods in the SandboxFileSystemLike
 *  interface that applyDiff consumes. Pure pass-through today;
 *  exists as a seam so future cross-cutting concerns (auditing,
 *  per-write logging, retry) live here, not in apply-diff.ts. */
export function createSandboxFsAdapter(session: SandboxSessionLike): SandboxFileSystemLike {
  return {
    read: (path) => session.fs.read(path),
    write: (path, content) => session.fs.write(path, content),
    exists: (path) => session.fs.exists(path),
    remove: (path) => session.fs.remove(path)
  };
}
