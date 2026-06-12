import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AgentCoordinator } from './agent-coordinator.js';

describe('AgentCoordinator suspend/resume', () => {
  it('suspend marks dev as suspended and stops active', async () => {
    const coordinator = new AgentCoordinator();
    const loopId = 'loop-test';

    await coordinator.activate(loopId, 'dev', { reason: 'manual' });
    assert.equal(coordinator.getStatus(loopId, 'dev'), 'active');

    const suspended: string[] = [];
    coordinator.on('agent:suspend', (e) => suspended.push(e.agent));

    await coordinator.suspend(loopId, 'dev', 'mention_handoff');
    assert.equal(coordinator.getStatus(loopId, 'dev'), 'suspended');
    assert.equal(coordinator.getActiveAgent(loopId), undefined);
    assert.deepEqual(suspended, ['dev']);
  });

  it('resume re-activates suspended agent with resume reason', async () => {
    const coordinator = new AgentCoordinator();
    const loopId = 'loop-test';

    await coordinator.activate(loopId, 'dev', { reason: 'manual' });
    await coordinator.suspend(loopId, 'dev', 'mention_handoff');

    const activated: string[] = [];
    coordinator.on('agent:activate', (e) => activated.push(`${e.agent}:${e.reason}`));

    await coordinator.resume(loopId, 'dev');
    assert.equal(coordinator.getStatus(loopId, 'dev'), 'active');
    assert.equal(coordinator.getSuspendedAgent(loopId), undefined);
    assert.deepEqual(activated, ['dev:resume']);
  });

  it('activate pm after suspend does not cancel suspended dev', async () => {
    const coordinator = new AgentCoordinator();
    const loopId = 'loop-test';

    await coordinator.activate(loopId, 'dev', { reason: 'manual' });
    await coordinator.suspend(loopId, 'dev', 'mention_handoff');
    await coordinator.activate(loopId, 'pm', { reason: 'mention' });

    assert.equal(coordinator.getStatus(loopId, 'dev'), 'suspended');
    assert.equal(coordinator.getStatus(loopId, 'pm'), 'active');
  });
});
