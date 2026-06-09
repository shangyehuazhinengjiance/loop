import type { ApprovalActionType, Phase } from '@loop/shared';
import type pg from 'pg';
import { getPool } from '../pool.js';

export interface ApprovalRow {
  id: string;
  loop_id: string;
  action: ApprovalActionType;
  approved_by: string;
  note: string | null;
  phase: Phase | null;
  created_at: Date;
}

export class ApprovalRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async create(input: {
    loopId: string;
    action: ApprovalActionType;
    approvedBy: string;
    phase: Phase;
    note?: string;
  }): Promise<ApprovalRow> {
    const result = await this.pool.query<ApprovalRow>(
      `INSERT INTO approvals (loop_id, action, approved_by, note, phase)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.loopId,
        input.action,
        input.approvedBy,
        input.note ?? null,
        input.phase,
      ],
    );
    return result.rows[0]!;
  }

  async hasApprovalInPhase(
    loopId: string,
    action: ApprovalActionType,
    phase: Phase,
  ): Promise<boolean> {
    const result = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM approvals
       WHERE loop_id = $1 AND action = $2 AND phase = $3`,
      [loopId, action, phase],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
  }

  async listByLoop(loopId: string): Promise<ApprovalRow[]> {
    const result = await this.pool.query<ApprovalRow>(
      'SELECT * FROM approvals WHERE loop_id = $1 ORDER BY created_at ASC',
      [loopId],
    );
    return result.rows;
  }
}
