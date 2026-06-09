import type { LoopContext, LoopStatus, Phase } from '@loop/shared';
import type pg from 'pg';
import { getPool } from '../pool.js';

export interface LoopRow {
  id: string;
  project_id: string;
  title: string;
  status: LoopStatus;
  phase: Phase;
  git_branch: string | null;
  workspace_path: string | null;
  context: LoopContext;
  model_overrides: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export class LoopRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async create(input: {
    projectId: string;
    title: string;
    workspacePath?: string;
  }): Promise<LoopRow> {
    const result = await this.pool.query<LoopRow>(
      `INSERT INTO loops (project_id, title, workspace_path)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.projectId, input.title, input.workspacePath ?? null],
    );
    return result.rows[0]!;
  }

  async findById(id: string): Promise<LoopRow | null> {
    const result = await this.pool.query<LoopRow>(
      'SELECT * FROM loops WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async updatePhase(
    id: string,
    phase: Phase,
    status?: LoopStatus,
  ): Promise<LoopRow> {
    const result = await this.pool.query<LoopRow>(
      `UPDATE loops
       SET phase = $2,
           status = COALESCE($3, status),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, phase, status ?? null],
    );
    return result.rows[0]!;
  }

  async updateWorkspacePath(id: string, workspacePath: string): Promise<LoopRow> {
    const result = await this.pool.query<LoopRow>(
      `UPDATE loops
       SET workspace_path = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, workspacePath],
    );
    return result.rows[0]!;
  }

  async updateGit(
    id: string,
    gitBranch: string,
    workspacePath: string,
  ): Promise<LoopRow> {
    const result = await this.pool.query<LoopRow>(
      `UPDATE loops
       SET git_branch = $2, workspace_path = $3, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, gitBranch, workspacePath],
    );
    return result.rows[0]!;
  }

  async updateContext(id: string, context: LoopContext): Promise<LoopRow> {
    const result = await this.pool.query<LoopRow>(
      `UPDATE loops
       SET context = $2::jsonb, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, JSON.stringify(context)],
    );
    return result.rows[0]!;
  }

  async listByProject(projectId: string): Promise<LoopRow[]> {
    const result = await this.pool.query<LoopRow>(
      'SELECT * FROM loops WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId],
    );
    return result.rows;
  }
}
