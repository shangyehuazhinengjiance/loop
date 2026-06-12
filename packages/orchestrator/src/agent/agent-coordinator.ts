import type { AgentRole } from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export type AgentStatus = 'active' | 'idle' | 'suspended';

export interface AgentActivateEvent {
  loopId: string;
  agent: AgentRole;
  reason:
    | 'phase_entry'
    | 'loop_entry'
    | 'mention'
    | 'rollback'
    | 'manual'
    | 'resume';
  userId?: string;
}

export interface AgentSuspendEvent {
  loopId: string;
  agent: AgentRole;
  reason: 'mention_handoff' | 'manual';
}

/** Agent 激活协调：同一 Loop 同时只允许一个 Agent active */
@Injectable()
export class AgentCoordinator extends EventEmitter {
  private readonly activeAgents = new Map<string, AgentRole>();
  private readonly suspendedAgents = new Map<string, AgentRole>();

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

  /** 挂起 Agent（保留 session，可后续 resume） */
  async suspend(
    loopId: string,
    agent: AgentRole,
    reason: AgentSuspendEvent['reason'] = 'mention_handoff',
  ): Promise<void> {
    if (this.activeAgents.get(loopId) === agent) {
      this.activeAgents.delete(loopId);
    }
    this.suspendedAgents.set(loopId, agent);
    this.emit('agent:suspend', { loopId, agent, reason });
  }

  /** 恢复此前挂起的 Agent */
  async resume(
    loopId: string,
    agent?: AgentRole,
    meta?: { userId?: string },
  ): Promise<void> {
    const target = agent ?? this.suspendedAgents.get(loopId);
    if (!target) return;

    this.suspendedAgents.delete(loopId);
    await this.activate(loopId, target, {
      reason: 'resume',
      userId: meta?.userId,
    });
  }

  /** 从持久化上下文恢复挂起标记（进程重启后） */
  markSuspended(loopId: string, agent: AgentRole): void {
    this.suspendedAgents.set(loopId, agent);
  }

  async cancel(loopId: string, agent: AgentRole): Promise<void> {
    if (this.activeAgents.get(loopId) === agent) {
      this.activeAgents.delete(loopId);
    }
    if (this.suspendedAgents.get(loopId) === agent) {
      this.suspendedAgents.delete(loopId);
    }
    this.emit('agent:cancel', { loopId, agent });
  }

  getStatus(loopId: string, agent: AgentRole): AgentStatus {
    if (this.activeAgents.get(loopId) === agent) return 'active';
    if (this.suspendedAgents.get(loopId) === agent) return 'suspended';
    return 'idle';
  }

  getSuspendedAgent(loopId: string): AgentRole | undefined {
    return this.suspendedAgents.get(loopId);
  }

  getActiveAgent(loopId: string): AgentRole | undefined {
    return this.activeAgents.get(loopId);
  }
}
