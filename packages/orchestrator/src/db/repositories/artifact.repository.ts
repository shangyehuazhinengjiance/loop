import type { ArtifactRecord, ArtifactType, Phase } from '@loop/shared';
import { toIso8601Utc } from '../datetime.js';
import { dbQuery, dbQueryOne, insertReturning, parseJsonField } from '../query.js';
import type { DbPool } from '../pool.js';
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

function mapRow(row: ArtifactRow): ArtifactRow {
  return {
    ...row,
    content: parseJsonField(row.content, {}),
  };
}

export class ArtifactRepository {
  constructor(private readonly pool: DbPool = getPool()) {}

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

    const row = await insertReturning<ArtifactRow>(this.pool, 'artifacts', [
      'loop_id',
      'phase',
      'type',
      'name',
      'version',
      'content',
      'diff_from',
      'created_by',
    ], [
      input.loopId,
      input.phase,
      input.type,
      input.name,
      version,
      JSON.stringify(input.content),
      input.diffFrom ?? latest?.id ?? null,
      input.createdBy,
    ]);
    return mapRow(row);
  }

  async findLatest(
    loopId: string,
    type: ArtifactType,
    name: string,
  ): Promise<ArtifactRow | null> {
    const row = await dbQueryOne<ArtifactRow>(
      this.pool,
      `SELECT * FROM artifacts
       WHERE loop_id = ? AND type = ? AND name = ?
       ORDER BY version DESC LIMIT 1`,
      [loopId, type, name],
    );
    return row ? mapRow(row) : null;
  }

  async findById(id: string): Promise<ArtifactRow | null> {
    const row = await dbQueryOne<ArtifactRow>(
      this.pool,
      'SELECT * FROM artifacts WHERE id = ?',
      [id],
    );
    return row ? mapRow(row) : null;
  }

  async listByLoop(loopId: string): Promise<ArtifactRow[]> {
    const rows = await dbQuery<ArtifactRow>(
      this.pool,
      'SELECT * FROM artifacts WHERE loop_id = ? ORDER BY created_at ASC',
      [loopId],
    );
    return rows.map(mapRow);
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
      createdAt: toIso8601Utc(row.created_at),
    };
  }
}
