import { createHash } from "node:crypto";

export class BranchNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BranchNameError";
  }
}

const ALLOWED = /^[A-Za-z0-9_-]+$/;

export function branchSchemaName(projectId: string, branchId: string): string {
  if (!branchId) throw new BranchNameError("branchId must be non-empty");
  if (!ALLOWED.test(branchId)) {
    throw new BranchNameError(`branchId contains illegal characters: "${branchId}"`);
  }
  const hash = createHash("sha256").update(`${projectId}|${branchId}`).digest("hex");
  return `br_${hash.slice(0, 16)}`;
}
