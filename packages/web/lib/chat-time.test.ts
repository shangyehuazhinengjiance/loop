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

  it('formatBubbleTimestamp includes seconds', () => {
    const a = formatBubbleTimestamp('2026-06-09T01:30:45.000Z');
    const b = formatBubbleTimestamp('2026-06-09T01:30:52.000Z');
    assert.match(a, /09:30:45/);
    assert.match(b, /09:30:52/);
    assert.notEqual(a, b);
  });

  it('formatChatTimestamp includes year for old messages', () => {
    assert.match(formatChatTimestamp('2020-06-09T01:00:00.000Z'), /2020年/);
  });
});
