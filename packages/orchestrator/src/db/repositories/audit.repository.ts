import { dbQuery, insertReturning, parseJsonField } from '../query.js';
import type { DbPool } from '../pool.js';
import { getPool } from '../pool.js';

export interface AuditRow {
  id: string;
  loop_id: string;
  agent: string | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: Date;
}

function mapRow(row: AuditRow): AuditRow {
  return {
    ...row,
    detail: parseJsonField(row.detail, {}),
  };
}

export class AuditRepository {
  constructor(private readonly pool: DbPool = getPool()) {}

  async create(input: {
    loopId: string;
    agent?: string;
    action: string;
    detail?: Record<string, unknown>;
  }): Promise<AuditRow> {
    const row = await insertReturning<AuditRow>(this.pool, 'audit_logs', [
      'loop_id',
      'agent',
      'action',
      'detail',
    ], [
      input.loopId,
      input.agent ?? null,
      input.action,
      JSON.stringify(input.detail ?? {}),
    ]);
    return mapRow(row);
  }

  async listByLoop(loopId: string, limit = 100): Promise<AuditRow[]> {
    const rows = await dbQuery<AuditRow>(
      this.pool,
      `SELECT * FROM audit_logs
       WHERE loop_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [loopId, limit],
    );
    return rows.map(mapRow);
  }
}
