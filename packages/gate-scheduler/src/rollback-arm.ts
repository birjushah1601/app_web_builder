export class RollbackArm {
  readonly commitSha: string;
  readonly reason: string;
  private _executed = false;
  constructor(commitSha: string, reason: string) {
    this.commitSha = commitSha;
    this.reason = reason;
  }
  get executed(): boolean { return this._executed; }
  /** Internal — only executeRollback should mark this. */
  _markExecuted(): void { this._executed = true; }
}

export type GitRevertFn = (commitSha: string) => Promise<string>;

export interface RollbackResult {
  success: boolean;
  output?: string;
  error?: string;
}

export async function executeRollback(arm: RollbackArm, gitRevert: GitRevertFn): Promise<RollbackResult> {
  try {
    const output = await gitRevert(arm.commitSha);
    arm._markExecuted();
    return { success: true, output };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
