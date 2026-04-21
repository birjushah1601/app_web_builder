import type { SandboxRecord } from "@atlas/sandbox-e2b";

export interface SandboxSession {
  record: SandboxRecord;
  /** Resolved HTTPS preview URL for the default dev port (3000 for Next.js, 8000 for FastAPI). */
  previewUrl: string;
}
