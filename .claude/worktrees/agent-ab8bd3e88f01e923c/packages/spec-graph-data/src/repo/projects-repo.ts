import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { SpecGraphRepo } from "./spec-graph.repo.js";

export interface ProjectRecord {
  projectId: string;
  userId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProjectInput {
  userId: string;
  name: string;
  /**
   * Optional projectId. When omitted, a fresh UUID v4 is generated. Tests
   * can pass a deterministic id; production callers should let the repo
   * generate one.
   */
  projectId?: string;
  /**
   * Optional initial spec-graph payload. Defaults to `{ nodes: {}, edges: [] }`
   * so the canvas page (which renders an empty graph today) keeps working
   * after the project row is created.
   */
  initialGraphData?: unknown;
}

interface ProjectRow {
  project_id: string;
  user_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Owns the user→projects mapping and per-project display metadata (name).
 * spec_graphs is the underlying tenant boundary (see drizzle/0003_enable_rls);
 * this table sits next to it with a 1:1 FK so deleting a spec_graph cascades
 * its project row.
 *
 * Why a separate repo (and not extra columns on spec_graphs):
 *   - spec_graphs is RLS-protected by `app.project_id`. Listing many
 *     projects for a user would require disabling RLS for that one read,
 *     which defeats the model. `projects` is intentionally NOT RLS-gated;
 *     it is a thin index.
 *   - Keeps the spec-graph data model focused on graph state and not user
 *     management.
 */
export class ProjectsRepo {
  private readonly graphs: SpecGraphRepo;

  constructor(private readonly pool: Pool) {
    this.graphs = new SpecGraphRepo(pool);
  }

  /**
   * Create the spec-graph row + the projects row. The two writes happen in
   * separate transactions (spec_graphs.create runs inside withProjectContext,
   * projects.insert runs as its own statement) — if the second fails we leave
   * the spec_graphs row behind, but the FK direction (`projects → spec_graphs`)
   * means the orphan is harmless and the next create attempt with the same
   * id would surface the unique-violation cleanly.
   */
  async create({ userId, name, projectId, initialGraphData }: CreateProjectInput): Promise<ProjectRecord> {
    if (!userId) throw new Error("ProjectsRepo.create: userId is required");
    if (!name?.trim()) throw new Error("ProjectsRepo.create: name is required");

    const id = projectId ?? randomUUID();
    const graphData = initialGraphData ?? { nodes: {}, edges: [] };

    // 1) Materialize the spec-graph parent row (RLS-aware).
    await this.graphs.create(id, graphData);

    // 2) Insert the projects row. RETURNING gives us authoritative timestamps.
    const r = await this.pool.query<ProjectRow>(
      `INSERT INTO projects (project_id, user_id, name)
       VALUES ($1, $2, $3)
       RETURNING project_id, user_id, name, created_at, updated_at`,
      [id, userId, name.trim()]
    );
    const row = r.rows[0];
    if (!row) throw new Error("ProjectsRepo.create: insert returned no row");
    return rowToRecord(row);
  }

  /**
   * List projects owned by the given user, newest first. Returns [] for
   * unknown users — never throws on "no projects".
   */
  async listForUser(userId: string): Promise<ProjectRecord[]> {
    if (!userId) return [];
    const r = await this.pool.query<ProjectRow>(
      `SELECT project_id, user_id, name, created_at, updated_at
       FROM projects
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    return r.rows.map(rowToRecord);
  }

  /**
   * Look up a single project. Returns null when the project does not exist.
   * Does NOT enforce ownership — callers that need an authorization check
   * must compare `record.userId` to the current user themselves.
   */
  async findById(projectId: string): Promise<ProjectRecord | null> {
    const r = await this.pool.query<ProjectRow>(
      `SELECT project_id, user_id, name, created_at, updated_at
       FROM projects
       WHERE project_id = $1`,
      [projectId]
    );
    const row = r.rows[0];
    return row ? rowToRecord(row) : null;
  }
}

function rowToRecord(row: ProjectRow): ProjectRecord {
  return {
    projectId: row.project_id,
    userId: row.user_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
