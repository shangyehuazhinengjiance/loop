import type { LoopContext, LoopSnapshot, Phase, PRDDocument, Task } from '@loop/shared';
import { toIso8601Utc } from '../datetime.js';
import { dbQuery, dbQueryOne, insertReturning, parseJsonField } from '../query.js';
import type { DbPool } from '../pool.js';
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

function mapRow(row: SnapshotRow): SnapshotRow {
  return {
    ...row,
    prd: row.prd ? parseJsonField(row.prd, null as unknown as PRDDocument) : null,
    tasks: row.tasks ? parseJsonField(row.tasks, [] as Task[]) : null,
  };
}

export class SnapshotRepository {
  constructor(private readonly pool: DbPool = getPool()) {}

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
    const row = await insertReturning<SnapshotRow>(this.pool, 'snapshots', [
      'loop_id',
      'phase',
      'label',
      'prd',
      'tasks',
      'git_ref',
      'git_branch',
      'dev_session_id',
      'message_watermark',
      'created_by',
    ], [
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
    ]);
    return mapRow(row);
  }

  async findLatestByPhase(
    loopId: string,
    phase: Phase,
  ): Promise<SnapshotRow | null> {
    const row = await dbQueryOne<SnapshotRow>(
      this.pool,
      `SELECT * FROM snapshots
       WHERE loop_id = ? AND phase = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [loopId, phase],
    );
    return row ? mapRow(row) : null;
  }

  async findById(id: string): Promise<SnapshotRow | null> {
    const row = await dbQueryOne<SnapshotRow>(
      this.pool,
      'SELECT * FROM snapshots WHERE id = ?',
      [id],
    );
    return row ? mapRow(row) : null;
  }

  async listByLoop(loopId: string): Promise<SnapshotRow[]> {
    const rows = await dbQuery<SnapshotRow>(
      this.pool,
      'SELECT * FROM snapshots WHERE loop_id = ? ORDER BY created_at DESC',
      [loopId],
    );
    return rows.map(mapRow);
  }

  toLoopSnapshot(row: SnapshotRow): LoopSnapshot {
    return {
      id: row.id,
      loopId: row.loop_id,
      phase: row.phase,
      label: row.label ?? '',
      createdAt: toIso8601Utc(row.created_at),
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
