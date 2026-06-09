import type pg from 'pg';
import { getPool } from '../pool.js';

export interface AuditRow {
  id: string;
  loop_id: string;
  agent: string | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: Date;
}

export class AuditRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async create(input: {
    loopId: string;
    agent?: string;
    action: string;
    detail?: Record<string, unknown>;
  }): Promise<AuditRow> {
    const result = await this.pool.query<AuditRow>(
      `INSERT INTO audit_logs (loop_id, agent, action, detail)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING *`,
      [
        input.loopId,
        input.agent ?? null,
        input.action,
        JSON.stringify(input.detail ?? {}),
      ],
    );
    return result.rows[0]!;
  }

  async listByLoop(loopId: string, limit = 100): Promise<AuditRow[]> {
    const result = await this.pool.query<AuditRow>(
      `SELECT * FROM audit_logs
       WHERE loop_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [loopId, limit],
    );
    return result.rows;
  }
}
