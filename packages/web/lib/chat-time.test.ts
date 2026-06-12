import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatBubbleTimestamp,
  formatLoopCreatedAt,
  formatChatTimestamp,
  parseMessageTime,
} from './chat-time.js';

const TZ_SHANGHAI = 'Asia/Shanghai';

describe('chat-time', () => {
  it('parseMessageTime accepts MySQL datetime without timezone', () => {
    const d = parseMessageTime('2026-06-09 01:30:45.123');
    assert.equal(d?.toISOString(), '2026-06-09T01:30:45.123Z');
  });

  it('formatLoopCreatedAt converts UTC to local (Asia/Shanghai)', () => {
    assert.equal(
      formatLoopCreatedAt('2026-06-09T01:30:45.000Z', TZ_SHANGHAI),
      '2026-06-09 09:30:45',
    );
  });

  it('formatBubbleTimestamp includes seconds in local TZ', () => {
    const a = formatBubbleTimestamp('2026-06-09T01:30:45.000Z', TZ_SHANGHAI);
    const b = formatBubbleTimestamp('2026-06-09T01:30:52.000Z', TZ_SHANGHAI);
    assert.match(a, /09:30:45/);
    assert.match(b, /09:30:52/);
    assert.notEqual(a, b);
  });

  it('formatChatTimestamp includes year for old messages', () => {
    assert.match(
      formatChatTimestamp('2020-06-09T01:00:00.000Z', TZ_SHANGHAI),
      /2020年/,
    );
  });
});
