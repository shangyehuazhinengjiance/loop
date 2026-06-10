import type { LoopMessage, Phase } from '@loop/shared';
import { dbQuery, dbQueryOne, insertReturning, parseJsonField } from '../query.js';
import type { DbPool } from '../pool.js';
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

function mapRow(row: MessageRow): MessageRow {
  return {
    ...row,
    content: parseJsonField(row.content, {}),
  };
}

export class MessageRepository {
  constructor(private readonly pool: DbPool = getPool()) {}

  async create(input: {
    loopId: string;
    phase: Phase;
    senderType: 'human' | 'agent' | 'system';
    senderId: string;
    content: LoopMessage['content'];
  }): Promise<MessageRow> {
    const row = await insertReturning<MessageRow>(this.pool, 'messages', [
      'loop_id',
      'phase',
      'sender_type',
      'sender_id',
      'content',
    ], [
      input.loopId,
      input.phase,
      input.senderType,
      input.senderId,
      JSON.stringify(input.content),
    ]);
    return mapRow(row);
  }

  async listByLoop(
    loopId: string,
    limit = 50,
    before?: string,
  ): Promise<MessageRow[]> {
    if (before) {
      const rows = await dbQuery<MessageRow>(
        this.pool,
        `SELECT * FROM messages
         WHERE loop_id = ? AND created_at < (SELECT created_at FROM messages WHERE id = ?)
         ORDER BY created_at DESC
         LIMIT ?`,
        [loopId, before, limit],
      );
      return rows.reverse().map(mapRow);
    }

    const rows = await dbQuery<MessageRow>(
      this.pool,
      `SELECT * FROM messages
       WHERE loop_id = ?
       ORDER BY created_at ASC
       LIMIT ?`,
      [loopId, limit],
    );
    return rows.map(mapRow);
  }

  async latestId(loopId: string): Promise<string | null> {
    const row = await dbQueryOne<{ id: string }>(
      this.pool,
      `SELECT id FROM messages
       WHERE loop_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [loopId],
    );
    return row?.id ?? null;
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
