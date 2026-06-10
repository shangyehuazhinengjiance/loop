import type { Phase, PhaseTransitionTrigger } from '@loop/shared';
import { dbQuery, insertReturning } from '../query.js';
import type { DbPool } from '../pool.js';
import { getPool } from '../pool.js';

export interface PhaseTransitionRow {
  id: string;
  loop_id: string;
  from_phase: Phase | null;
  to_phase: Phase;
  trigger: PhaseTransitionTrigger;
  snapshot_id: string | null;
  created_at: Date;
}

export class PhaseTransitionRepository {
  constructor(private readonly pool: DbPool = getPool()) {}

  async create(input: {
    loopId: string;
    fromPhase: Phase | null;
    toPhase: Phase;
    trigger: PhaseTransitionTrigger;
    snapshotId?: string;
  }): Promise<PhaseTransitionRow> {
    return insertReturning<PhaseTransitionRow>(
      this.pool,
      'phase_transitions',
      ['loop_id', 'from_phase', 'to_phase', 'trigger', 'snapshot_id'],
      [
        input.loopId,
        input.fromPhase,
        input.toPhase,
        input.trigger,
        input.snapshotId ?? null,
      ],
    );
  }

  async listByLoop(loopId: string): Promise<PhaseTransitionRow[]> {
    return dbQuery<PhaseTransitionRow>(
      this.pool,
      'SELECT * FROM phase_transitions WHERE loop_id = ? ORDER BY created_at ASC',
      [loopId],
    );
  }
}
