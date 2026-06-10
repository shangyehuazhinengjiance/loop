import type { LoopContext, LoopStatus, Phase } from '@loop/shared';
import { dbQuery, dbQueryOne, insertReturning, parseJsonField, updateReturning } from '../query.js';
import type { DbPool } from '../pool.js';
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

function mapRow(row: LoopRow): LoopRow {
  return {
    ...row,
    context: parseJsonField(row.context, {} as LoopContext),
    model_overrides: row.model_overrides
      ? parseJsonField(row.model_overrides, {})
      : null,
  };
}

export class LoopRepository {
  constructor(private readonly pool: DbPool = getPool()) {}

  async create(input: {
    projectId: string;
    title: string;
    workspacePath?: string;
  }): Promise<LoopRow> {
    const row = await insertReturning<LoopRow>(this.pool, 'loops', [
      'project_id',
      'title',
      'workspace_path',
      'context',
    ], [
      input.projectId,
      input.title,
      input.workspacePath ?? null,
      JSON.stringify({}),
    ]);
    return mapRow(row);
  }

  async findById(id: string): Promise<LoopRow | null> {
    const row = await dbQueryOne<LoopRow>(
      this.pool,
      'SELECT * FROM loops WHERE id = ?',
      [id],
    );
    return row ? mapRow(row) : null;
  }

  async updatePhase(
    id: string,
    phase: Phase,
    status?: LoopStatus,
  ): Promise<LoopRow> {
    const row = await updateReturning<LoopRow>(
      this.pool,
      'loops',
      'phase = ?, status = COALESCE(?, status), updated_at = NOW(3)',
      id,
      [phase, status ?? null],
    );
    return mapRow(row);
  }

  async updateWorkspacePath(id: string, workspacePath: string): Promise<LoopRow> {
    const row = await updateReturning<LoopRow>(
      this.pool,
      'loops',
      'workspace_path = ?, updated_at = NOW(3)',
      id,
      [workspacePath],
    );
    return mapRow(row);
  }

  async updateGit(
    id: string,
    gitBranch: string,
    workspacePath: string,
  ): Promise<LoopRow> {
    const row = await updateReturning<LoopRow>(
      this.pool,
      'loops',
      'git_branch = ?, workspace_path = ?, updated_at = NOW(3)',
      id,
      [gitBranch, workspacePath],
    );
    return mapRow(row);
  }

  async updateContext(id: string, context: LoopContext): Promise<LoopRow> {
    const row = await updateReturning<LoopRow>(
      this.pool,
      'loops',
      'context = ?, updated_at = NOW(3)',
      id,
      [JSON.stringify(context)],
    );
    return mapRow(row);
  }

  async listByProject(projectId: string): Promise<LoopRow[]> {
    const rows = await dbQuery<LoopRow>(
      this.pool,
      'SELECT * FROM loops WHERE project_id = ? ORDER BY created_at DESC',
      [projectId],
    );
    return rows.map(mapRow);
  }
}
