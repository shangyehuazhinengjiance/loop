import type { ProjectModelConfig } from '@loop/shared';
import { dbQuery, dbQueryOne, insertReturning, parseJsonField, updateReturning } from '../query.js';
import type { DbPool } from '../pool.js';
import { getPool } from '../pool.js';

export interface ProjectRow {
  id: string;
  name: string;
  git_config: Record<string, unknown>;
  model_config: ProjectModelConfig;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: ProjectRow): ProjectRow {
  return {
    ...row,
    git_config: parseJsonField(row.git_config, {}),
    model_config: parseJsonField(row.model_config, {} as ProjectModelConfig),
  };
}

export class ProjectRepository {
  constructor(private readonly pool: DbPool = getPool()) {}

  async create(input: {
    name: string;
    gitConfig: Record<string, unknown>;
    modelConfig: ProjectModelConfig;
  }): Promise<ProjectRow> {
    const row = await insertReturning<ProjectRow>(this.pool, 'projects', [
      'name',
      'git_config',
      'model_config',
    ], [
      input.name,
      JSON.stringify(input.gitConfig),
      JSON.stringify(input.modelConfig),
    ]);
    return mapRow(row);
  }

  async listAll(): Promise<ProjectRow[]> {
    const rows = await dbQuery<ProjectRow>(
      this.pool,
      'SELECT * FROM projects ORDER BY created_at DESC',
    );
    return rows.map(mapRow);
  }

  async findById(id: string): Promise<ProjectRow | null> {
    const row = await dbQueryOne<ProjectRow>(
      this.pool,
      'SELECT * FROM projects WHERE id = ?',
      [id],
    );
    return row ? mapRow(row) : null;
  }

  async updateGitConfig(
    id: string,
    gitConfig: Record<string, unknown>,
  ): Promise<ProjectRow> {
    const row = await updateReturning<ProjectRow>(
      this.pool,
      'projects',
      'git_config = ?, updated_at = NOW(3)',
      id,
      [JSON.stringify(gitConfig)],
    );
    return mapRow(row);
  }

  async delete(id: string): Promise<void> {
    await dbQuery(this.pool, 'DELETE FROM projects WHERE id = ?', [id]);
  }
}
