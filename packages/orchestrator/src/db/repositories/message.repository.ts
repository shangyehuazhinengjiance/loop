import type { LoopMessage, Phase } from '@loop/shared';
import type pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../pool.js';

export interface MessageRow {
  id: string;
  loop_id: string;
  phase: Phase;
  sender_type: string;
  sender_id: string;
  content: Record<string, unknown>;
  created_at: Date;
}

export class MessageRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  async create(input: {
    loopId: string;
    phase: Phase;
    senderType: 'human' | 'agent' | 'system';
    senderId: string;
    content: LoopMessage['content'];
  }): Promise<MessageRow> {
    const result = await this.pool.query<MessageRow>(
      `INSERT INTO messages (loop_id, phase, sender_type, sender_id, content)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING *`,
      [
        input.loopId,
        input.phase,
        input.senderType,
        input.senderId,
        JSON.stringify(input.content),
      ],
    );
    return result.rows[0]!;
  }

  async listByLoop(
    loopId: string,
    limit = 50,
    before?: string,
  ): Promise<MessageRow[]> {
    if (before) {
      const result = await this.pool.query<MessageRow>(
        `SELECT * FROM messages
         WHERE loop_id = $1 AND created_at < (SELECT created_at FROM messages WHERE id = $2)
         ORDER BY created_at DESC
         LIMIT $3`,
        [loopId, before, limit],
      );
      return result.rows.reverse();
    }

    const result = await this.pool.query<MessageRow>(
      `SELECT * FROM messages
       WHERE loop_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [loopId, limit],
    );
    return result.rows;
  }

  async latestId(loopId: string): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM messages
       WHERE loop_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [loopId],
    );
    return result.rows[0]?.id ?? null;
  }

  toLoopMessage(row: MessageRow, displayName: string): LoopMessage {
    const content = row.content as LoopMessage['content'];
    return {
      id: row.id,
      loopId: row.loop_id,
      phase: row.phase,
      sender: {
        type: row.sender_type as LoopMessage['sender']['type'],
        id: row.sender_id,
        displayName,
      },
      content,
      metadata: {
        timestamp: row.created_at.toISOString(),
      },
    };
  }

  systemMessage(
    loopId: string,
    phase: Phase,
    body: string,
    extra?: Partial<LoopMessage['content']>,
  ): Parameters<MessageRepository['create']>[0] {
    return {
      loopId,
      phase,
      senderType: 'system',
      senderId: 'orchestrator',
      content: {
        type: 'text',
        body,
        ...extra,
      },
    };
  }
}
