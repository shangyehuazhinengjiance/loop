import type { ProjectModelConfig } from '@loop/shared';
import type pg from 'pg';
import { getPool } from '../pool.js';

export interface ProjectRow {
  id: string;
  name: string;
  git_config: Record<string, unknown>;
  model_config: ProjectModelConfig;
  created_at: Date;
  updated_at: Date;
}

export class ProjectRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async create(input: {
    name: string;
    gitConfig: Record<string, unknown>;
    modelConfig: ProjectModelConfig;
  }): Promise<ProjectRow> {
    const result = await this.pool.query<ProjectRow>(
      `INSERT INTO projects (name, git_config, model_config)
       VALUES ($1, $2::jsonb, $3::jsonb)
       RETURNING *`,
      [input.name, JSON.stringify(input.gitConfig), JSON.stringify(input.modelConfig)],
    );
    return result.rows[0]!;
  }

  async findById(id: string): Promise<ProjectRow | null> {
    const result = await this.pool.query<ProjectRow>(
      'SELECT * FROM projects WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }
}
