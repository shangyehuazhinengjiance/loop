import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PhaseStateMachine } from '@loop/shared';

describe('Approval phase mapping', () => {
  const sm = new PhaseStateMachine();

  it('approve_prd requires requirement phase transition', () => {
    assert.equal(sm.canTransition('requirement', 'approve_prd'), true);
    assert.equal(sm.canTransition('development', 'approve_prd'), false);
  });

  it('approve_dev requires development phase', () => {
    assert.equal(sm.canTransition('development', 'approve_dev'), true);
  });

  it('approve_deploy requires deployment phase', () => {
    assert.equal(sm.canTransition('deployment', 'approve_deploy'), true);
  });
});
