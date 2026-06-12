import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toIso8601Utc } from './datetime.js';

describe('toIso8601Utc', () => {
  it('serializes Date to ISO with Z', () => {
    const iso = toIso8601Utc(new Date('2026-06-09T01:30:45.000Z'));
    assert.equal(iso, '2026-06-09T01:30:45.000Z');
  });

  it('normalizes MySQL datetime string to UTC ISO', () => {
    assert.equal(
      toIso8601Utc('2026-06-09 01:30:45.123'),
      '2026-06-09T01:30:45.123Z',
    );
  });

  it('passes through existing ISO strings', () => {
    assert.equal(
      toIso8601Utc('2026-06-09T09:30:45.000Z'),
      '2026-06-09T09:30:45.000Z',
    );
  });
});
