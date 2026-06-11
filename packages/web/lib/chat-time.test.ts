import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatBubbleTimestamp,
  formatLoopCreatedAt,
  formatChatTimestamp,
} from './chat-time.js';

describe('chat-time UTC+8', () => {
  it('formatLoopCreatedAt uses东八区', () => {
    assert.equal(
      formatLoopCreatedAt('2026-06-09T01:30:45.000Z'),
      '2026-06-09 09:30:45',
    );
  });

  it('formatBubbleTimestamp shows HH:mm for same UTC+8 day', () => {
    const iso = '2026-06-09T01:30:45.000Z';
    const result = formatBubbleTimestamp(iso);
    assert.match(result, /09:30/);
  });

  it('formatChatTimestamp includes year for old messages', () => {
    assert.match(formatChatTimestamp('2020-06-09T01:00:00.000Z'), /2020年/);
  });
});
