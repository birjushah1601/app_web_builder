// packages/spec-graph-data/src/repo/eval-verdict.repo.ts
import { and, desc, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  evalVerdicts,
  type EvalVerdictRow,
  type NewEvalVerdictRow
} from "../schema/eval-verdicts.js";

export class EvalVerdictRepo {
  private db: ReturnType<typeof drizzle>;
  constructor(pool: Pool) {
    this.db = drizzle(pool);
  }

  async insert(input: NewEvalVerdictRow): Promise<EvalVerdictRow> {
    const [row] = await this.db.insert(evalVerdicts).values(input).returning();
    return row!;
  }

  async findByRitual(ritualId: string): Promise<EvalVerdictRow[]> {
    return this.db
      .select()
      .from(evalVerdicts)
      .where(eq(evalVerdicts.ritualId, ritualId))
      .orderBy(desc(evalVerdicts.createdAt));
  }

  async findFailuresForRole(roleId: string, limit: number): Promise<EvalVerdictRow[]> {
    return this.db
      .select()
      .from(evalVerdicts)
      .where(and(eq(evalVerdicts.roleId, roleId), eq(evalVerdicts.passed, false)))
      .orderBy(desc(evalVerdicts.createdAt))
      .limit(limit);
  }

  async findUniqueByInputHash(
    roleId: string,
    priorArtifactHash: string,
    userTurn: string
  ): Promise<EvalVerdictRow[]> {
    return this.db
      .select()
      .from(evalVerdicts)
      .where(and(
        eq(evalVerdicts.roleId, roleId),
        eq(evalVerdicts.priorArtifactHash, priorArtifactHash),
        eq(evalVerdicts.userTurn, userTurn)
      ));
  }
}
