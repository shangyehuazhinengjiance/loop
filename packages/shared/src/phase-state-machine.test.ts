import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PhaseStateMachine, PhaseTransitionError } from './phase-state-machine.js';

describe('PhaseStateMachine', () => {
  const sm = new PhaseStateMachine();

  it('start: created → requirement', () => {
    const result = sm.transition('created', 'start');
    assert.equal(result.toPhase, 'requirement');
    assert.equal(result.activateAgent, 'pm');
  });

  it('approve_prd: requirement → development', () => {
    const result = sm.transition('requirement', 'approve_prd');
    assert.equal(result.toPhase, 'development');
    assert.equal(result.activateAgent, 'dev');
  });

  it('approve_dev: development → deployment', () => {
    const result = sm.transition('development', 'approve_dev');
    assert.equal(result.toPhase, 'deployment');
    assert.equal(result.activateAgent, 'ops');
  });

  it('approve_deploy: deployment → done', () => {
    const result = sm.transition('deployment', 'approve_deploy');
    assert.equal(result.toPhase, 'done');
    assert.equal(result.activateAgent, undefined);
  });

  it('rejects invalid forward transition', () => {
    assert.throws(
      () => sm.transition('created', 'approve_prd'),
      PhaseTransitionError,
    );
  });

  it('rollback: development → requirement', () => {
    const result = sm.rollback('development', 'requirement');
    assert.equal(result.toPhase, 'requirement');
    assert.equal(result.activateAgent, 'pm');
  });

  it('rollback: deployment → development', () => {
    const result = sm.rollback('deployment', 'development');
    assert.equal(result.toPhase, 'development');
    assert.equal(result.activateAgent, 'dev');
  });

  it('rejects invalid rollback', () => {
    assert.throws(
      () => sm.rollback('requirement', 'development'),
      PhaseTransitionError,
    );
  });
});
