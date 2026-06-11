import type { AgentRole } from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export interface AgentActivateEvent {
  loopId: string;
  agent: AgentRole;
  reason: 'phase_entry' | 'loop_entry' | 'mention' | 'rollback' | 'manual';
  userId?: string;
}

/** Agent 激活协调：同一 Loop 同时只允许一个 Agent active */
@Injectable()
export class AgentCoordinator extends EventEmitter {
  private readonly activeAgents = new Map<string, AgentRole>();

  async activate(
    loopId: string,
    agent: AgentRole,
    meta: { reason: AgentActivateEvent['reason']; userId?: string },
  ): Promise<void> {
    const current = this.activeAgents.get(loopId);
    if (current && current !== agent) {
      this.emit('agent:cancel', { loopId, agent: current });
    }

    this.activeAgents.set(loopId, agent);
    const event: AgentActivateEvent = {
      loopId,
      agent,
      reason: meta.reason,
      userId: meta.userId,
    };
    this.emit('agent:activate', event);
  }

  async cancel(loopId: string, agent: AgentRole): Promise<void> {
    if (this.activeAgents.get(loopId) === agent) {
      this.activeAgents.delete(loopId);
    }
    this.emit('agent:cancel', { loopId, agent });
  }

  getStatus(loopId: string, agent: AgentRole): 'active' | 'idle' {
    return this.activeAgents.get(loopId) === agent ? 'active' : 'idle';
  }
}
