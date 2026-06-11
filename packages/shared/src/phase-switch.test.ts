import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PhaseStateMachine } from './phase-state-machine.js';
import {
  collectReachedPhases,
  getAllowedPhaseSwitchTargets,
} from './phase-switch.js';

describe('phase switch', () => {
  const sm = new PhaseStateMachine();

  it('deployment can switch back to reached earlier phases only', () => {
    const reached = collectReachedPhases('deployment', [
      { fromPhase: 'created', toPhase: 'requirement' },
      { fromPhase: 'requirement', toPhase: 'development' },
      { fromPhase: 'development', toPhase: 'deployment' },
    ]);
    const targets = getAllowedPhaseSwitchTargets(
      'deployment',
      reached,
      sm.getRollbackTargets('deployment'),
    );
    assert.deepEqual(targets, ['development', 'requirement']);
  });

  it('requirement after rollback cannot jump forward to deployment', () => {
    const reached = collectReachedPhases('requirement', [
      { fromPhase: 'deployment', toPhase: 'requirement' },
    ]);
    const targets = getAllowedPhaseSwitchTargets(
      'requirement',
      reached,
      sm.getRollbackTargets('requirement'),
    );
    assert.deepEqual(targets, []);
  });
});
