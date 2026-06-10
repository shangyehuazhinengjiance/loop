import type { ApprovalActionType, Phase } from '@loop/shared';
import { dbQuery, dbQueryOne, insertReturning } from '../query.js';
import type { DbPool } from '../pool.js';
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
  constructor(private readonly pool: DbPool = getPool()) {}

  async create(input: {
    loopId: string;
    action: ApprovalActionType;
    approvedBy: string;
    phase: Phase;
    note?: string;
  }): Promise<ApprovalRow> {
    return insertReturning<ApprovalRow>(this.pool, 'approvals', [
      'loop_id',
      'action',
      'approved_by',
      'note',
      'phase',
    ], [
      input.loopId,
      input.action,
      input.approvedBy,
      input.note ?? null,
      input.phase,
    ]);
  }

  async hasApprovalInPhase(
    loopId: string,
    action: ApprovalActionType,
    phase: Phase,
  ): Promise<boolean> {
    const row = await dbQueryOne<{ count: number }>(
      this.pool,
      `SELECT COUNT(*) AS count FROM approvals
       WHERE loop_id = ? AND action = ? AND phase = ?`,
      [loopId, action, phase],
    );
    return Number(row?.count ?? 0) > 0;
  }

  async listByLoop(loopId: string): Promise<ApprovalRow[]> {
    return dbQuery<ApprovalRow>(
      this.pool,
      'SELECT * FROM approvals WHERE loop_id = ? ORDER BY created_at ASC',
      [loopId],
    );
  }
}
