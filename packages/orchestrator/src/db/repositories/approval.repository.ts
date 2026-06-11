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

const PHASE_PIPELINE: Phase[] = [
  'created',
  'requirement',
  'development',
  'deployment',
  'done',
];

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

  /** 回退后清除目标阶段及之后阶段的审批记录，允许重新确认 */
  async deleteApprovalsFromPhaseOnwards(
    loopId: string,
    fromPhase: Phase,
  ): Promise<void> {
    const idx = PHASE_PIPELINE.indexOf(fromPhase);
    if (idx < 0) return;
    const phases = PHASE_PIPELINE.slice(idx);
    const placeholders = phases.map(() => '?').join(', ');
    await dbQuery(
      this.pool,
      `DELETE FROM approvals WHERE loop_id = ? AND phase IN (${placeholders})`,
      [loopId, ...phases],
    );
  }
}
