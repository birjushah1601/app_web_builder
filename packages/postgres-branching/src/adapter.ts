import type { Pool } from "pg";
import { branchSchemaName } from "./naming.js";
import { BranchOperationError } from "./errors.js";

export interface EnsureBranchResult {
  schemaName: string;
  created: boolean;
}

export interface DropBranchResult {
  schemaName: string;
  dropped: boolean;
}

export class PgBranchingAdapter {
  constructor(private readonly pool: Pool) {}

  async ensureBranch(projectId: string, branchId: string): Promise<EnsureBranchResult> {
    const schemaName = branchSchemaName(projectId, branchId);
    try {
      const before = await this.pool.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists",
        [schemaName]
      );
      const existed = before.rows[0]?.exists === true;
      if (!existed) {
        await this.pool.query(`CREATE SCHEMA "${schemaName}"`);
      }
      return { schemaName, created: !existed };
    } catch (err) {
      throw new BranchOperationError(`ensureBranch(${projectId}, ${branchId}) failed`, { cause: err });
    }
  }

  async dropBranch(projectId: string, branchId: string): Promise<DropBranchResult> {
    const schemaName = branchSchemaName(projectId, branchId);
    try {
      const before = await this.pool.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = $1) AS exists",
        [schemaName]
      );
      const existed = before.rows[0]?.exists === true;
      if (existed) {
        await this.pool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
      return { schemaName, dropped: existed };
    } catch (err) {
      throw new BranchOperationError(`dropBranch(${projectId}, ${branchId}) failed`, { cause: err });
    }
  }

  async listBranches(_projectId: string): Promise<string[]> {
    const r = await this.pool.query<{ schema_name: string }>(
      "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'br_%' ORDER BY schema_name"
    );
    return r.rows.map((row) => row.schema_name);
  }
}
