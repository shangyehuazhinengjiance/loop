import type { AgentRole, Phase } from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { ChatService } from './chat.service.js';

@Injectable()
export class LoopProgressService {
  constructor(private readonly chatService: ChatService) {}

  async publish(input: {
    loopId: string;
    phase: Phase | string;
    label: string;
    detail?: string;
    agentId?: string;
    updateBanner?: boolean;
  }): Promise<void> {
    const agentId = input.agentId ?? 'orchestrator';
    const body = input.detail
      ? `**${input.label}**\n\n${input.detail}`
      : input.label;

    await this.chatService.publishAgentMessage({
      loopId: input.loopId,
      phase: input.phase as Phase,
      agentId,
      content: { type: 'progress', body },
    });

    if (input.updateBanner !== false) {
      const agentRole: AgentRole | undefined =
        agentId === 'pm-agent'
          ? 'pm'
          : agentId === 'dev-agent'
            ? 'dev'
            : agentId === 'ops-agent'
              ? 'ops'
              : undefined;
      this.chatService.emitProcessing({
        loopId: input.loopId,
        active: true,
        agent: agentRole,
        label: input.label,
      });
    }
  }
}
