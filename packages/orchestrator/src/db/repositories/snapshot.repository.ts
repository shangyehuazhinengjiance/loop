import type { LoopContext, LoopSnapshot, Phase, PRDDocument, Task } from '@loop/shared';
import type pg from 'pg';
import { getPool } from '../pool.js';

export interface SnapshotRow {
  id: string;
  loop_id: string;
  phase: Phase;
  label: string | null;
  prd: PRDDocument | null;
  tasks: Task[] | null;
  git_ref: string | null;
  git_branch: string | null;
  dev_session_id: string | null;
  message_watermark: string | null;
  created_by: string | null;
  created_at: Date;
}

export class SnapshotRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async create(input: {
    loopId: string;
    phase: Phase;
    label: string;
    createdBy: string;
    context: LoopContext;
    gitRef?: string;
    gitBranch?: string;
    messageWatermark?: string;
  }): Promise<SnapshotRow> {
    const result = await this.pool.query<SnapshotRow>(
      `INSERT INTO snapshots (
         loop_id, phase, label, prd, tasks,
         git_ref, git_branch, dev_session_id, message_watermark, created_by
       ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.loopId,
        input.phase,
        input.label,
        input.context.prd ? JSON.stringify(input.context.prd) : null,
        input.context.tasks ? JSON.stringify(input.context.tasks) : null,
        input.gitRef ?? input.context.gitRef ?? null,
        input.gitBranch ?? null,
        input.context.devSessionId ?? null,
        input.messageWatermark ?? null,
        input.createdBy,
      ],
    );
    return result.rows[0]!;
  }

  async findLatestByPhase(
    loopId: string,
    phase: Phase,
  ): Promise<SnapshotRow | null> {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT * FROM snapshots
       WHERE loop_id = $1 AND phase = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [loopId, phase],
    );
    return result.rows[0] ?? null;
  }

  async findById(id: string): Promise<SnapshotRow | null> {
    const result = await this.pool.query<SnapshotRow>(
      'SELECT * FROM snapshots WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listByLoop(loopId: string): Promise<SnapshotRow[]> {
    const result = await this.pool.query<SnapshotRow>(
      'SELECT * FROM snapshots WHERE loop_id = $1 ORDER BY created_at DESC',
      [loopId],
    );
    return result.rows;
  }

  toLoopSnapshot(row: SnapshotRow): LoopSnapshot {
    return {
      id: row.id,
      loopId: row.loop_id,
      phase: row.phase,
      label: row.label ?? '',
      createdAt: row.created_at.toISOString(),
      createdBy: row.created_by ?? 'system',
      prd: row.prd ?? undefined,
      tasks: row.tasks ?? undefined,
      gitRef: row.git_ref ?? '',
      gitBranch: row.git_branch ?? '',
      devSessionId: row.dev_session_id ?? undefined,
      messageWatermark: row.message_watermark ?? '',
    };
  }
}
