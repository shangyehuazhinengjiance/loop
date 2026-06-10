import type { LoopMember } from '@loop/shared';
import { dbQuery, dbQueryOne } from '../query.js';
import type { DbPool } from '../pool.js';
import { getPool } from '../pool.js';

export interface LoopMemberRow {
  loop_id: string;
  user_id: string;
  display_name: string;
  bio: string;
  joined_at: Date;
}

function mapRow(row: LoopMemberRow): LoopMember {
  return {
    loopId: row.loop_id,
    userId: row.user_id,
    displayName: row.display_name,
    bio: row.bio ?? '',
    joinedAt: row.joined_at.toISOString(),
  };
}

export class LoopMemberRepository {
  constructor(private readonly pool: DbPool = getPool()) {}

  async upsert(input: {
    loopId: string;
    userId: string;
    displayName: string;
    bio?: string;
  }): Promise<LoopMember> {
    await this.pool.execute(
      `INSERT INTO loop_members (loop_id, user_id, display_name, bio)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         bio = VALUES(bio)`,
      [input.loopId, input.userId, input.displayName, input.bio ?? ''],
    );
    const row = await this.find(input.loopId, input.userId);
    if (!row) throw new Error('Failed to upsert loop member');
    return row;
  }

  async find(loopId: string, userId: string): Promise<LoopMember | null> {
    const row = await dbQueryOne<LoopMemberRow>(
      this.pool,
      'SELECT * FROM loop_members WHERE loop_id = ? AND user_id = ?',
      [loopId, userId],
    );
    return row ? mapRow(row) : null;
  }

  async listByLoop(loopId: string): Promise<LoopMember[]> {
    const rows = await dbQuery<LoopMemberRow>(
      this.pool,
      'SELECT * FROM loop_members WHERE loop_id = ? ORDER BY joined_at ASC',
      [loopId],
    );
    return rows.map(mapRow);
  }
}
