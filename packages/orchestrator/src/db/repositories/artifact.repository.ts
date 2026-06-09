import type { ArtifactRecord, ArtifactType, Phase } from '@loop/shared';
import type pg from 'pg';
import { getPool } from '../pool.js';

export interface ArtifactRow {
  id: string;
  loop_id: string;
  phase: Phase;
  type: ArtifactType;
  name: string;
  version: number;
  content: Record<string, unknown>;
  diff_from: string | null;
  created_by: string;
  created_at: Date;
}

export class ArtifactRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async create(input: {
    loopId: string;
    phase: Phase;
    type: ArtifactType;
    name: string;
    content: Record<string, unknown>;
    createdBy: string;
    diffFrom?: string;
  }): Promise<ArtifactRow> {
    const latest = await this.findLatest(input.loopId, input.type, input.name);
    const version = (latest?.version ?? 0) + 1;

    const result = await this.pool.query<ArtifactRow>(
      `INSERT INTO artifacts (
         loop_id, phase, type, name, version, content, diff_from, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       RETURNING *`,
      [
        input.loopId,
        input.phase,
        input.type,
        input.name,
        version,
        JSON.stringify(input.content),
        input.diffFrom ?? latest?.id ?? null,
        input.createdBy,
      ],
    );
    return result.rows[0]!;
  }

  async findLatest(
    loopId: string,
    type: ArtifactType,
    name: string,
  ): Promise<ArtifactRow | null> {
    const result = await this.pool.query<ArtifactRow>(
      `SELECT * FROM artifacts
       WHERE loop_id = $1 AND type = $2 AND name = $3
       ORDER BY version DESC LIMIT 1`,
      [loopId, type, name],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<ArtifactRow | null> {
    const result = await this.pool.query<ArtifactRow>(
      'SELECT * FROM artifacts WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listByLoop(loopId: string): Promise<ArtifactRow[]> {
    const result = await this.pool.query<ArtifactRow>(
      'SELECT * FROM artifacts WHERE loop_id = $1 ORDER BY created_at ASC',
      [loopId],
    );
    return result.rows;
  }

  toRecord(row: ArtifactRow): ArtifactRecord {
    return {
      id: row.id,
      loopId: row.loop_id,
      phase: row.phase,
      type: row.type,
      name: row.name,
      version: row.version,
      content: row.content,
      diffFrom: row.diff_from ?? undefined,
      createdBy: row.created_by,
      createdAt: row.created_at.toISOString(),
    };
  }
}
