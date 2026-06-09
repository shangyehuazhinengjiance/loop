import type { Phase, PhaseTransitionTrigger } from '@loop/shared';
import type pg from 'pg';
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
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async create(input: {
    loopId: string;
    fromPhase: Phase | null;
    toPhase: Phase;
    trigger: PhaseTransitionTrigger;
    snapshotId?: string;
  }): Promise<PhaseTransitionRow> {
    const result = await this.pool.query<PhaseTransitionRow>(
      `INSERT INTO phase_transitions (loop_id, from_phase, to_phase, trigger, snapshot_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.loopId,
        input.fromPhase,
        input.toPhase,
        input.trigger,
        input.snapshotId ?? null,
      ],
    );
    return result.rows[0]!;
  }

  async listByLoop(loopId: string): Promise<PhaseTransitionRow[]> {
    const result = await this.pool.query<PhaseTransitionRow>(
      'SELECT * FROM phase_transitions WHERE loop_id = $1 ORDER BY created_at ASC',
      [loopId],
    );
    return result.rows;
  }
}
