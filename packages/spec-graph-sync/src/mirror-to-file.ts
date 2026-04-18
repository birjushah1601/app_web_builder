import { createHash } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import type { SpecGraphRepo } from "@atlas/spec-graph-data";
import type { WriteTokenRegistry } from "./write-token.js";

export interface WriteGraphArgs {
  projectId: string;
  graphPath: string;
  graphRepo: SpecGraphRepo;
  tokens: WriteTokenRegistry;
}

/**
 * Reads the authoritative mirror state for `projectId` and writes it to
 * `graphPath` atomically: write a `.tmp` sibling, fsync it, rename over
 * the target. Registers the output's SHA-256 hash in the write-token
 * registry so the resulting filesystem event will be filtered out.
 */
export async function writeGraphFromMirror(args: WriteGraphArgs): Promise<void> {
  const { projectId, graphPath, graphRepo, tokens } = args;
  const row = await graphRepo.findByProjectId(projectId);
  if (!row) {
    throw new Error(`writeGraphFromMirror: no mirror row for project ${projectId}`);
  }
  const serialized = `${JSON.stringify(row.graphData, null, 2)}\n`;
  const tmpPath = `${graphPath}.tmp`;
  const fh = await open(tmpPath, "w");
  try {
    await fh.writeFile(serialized, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
  try {
    await rename(tmpPath, graphPath);
  } catch (err) {
    // Best-effort cleanup so a failed rename doesn't leave a stray .tmp
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
  const hash = createHash("sha256").update(serialized).digest("hex");
  tokens.register(graphPath, hash);
}
