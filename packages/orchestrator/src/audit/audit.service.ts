import { Injectable } from '@nestjs/common';
import { AuditRepository } from '../db/repositories/audit.repository.js';
import { ChatService } from '../chat/chat.service.js';
import type { Phase } from '@loop/shared';

@Injectable()
export class AuditService {
  constructor(
    private readonly auditRepo: AuditRepository,
    private readonly chatService: ChatService,
  ) {}

  async log(input: {
    loopId: string;
    agent?: string;
    action: string;
    detail?: Record<string, unknown>;
    notifyChat?: boolean;
    phase?: Phase;
  }) {
    const row = await this.auditRepo.create(input);

    if (input.notifyChat) {
      await this.chatService.publishAgentMessage({
        loopId: input.loopId,
        phase: input.phase ?? 'development',
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: `[审计] ${input.agent ?? 'system'}: ${input.action}`,
        },
      });
    }

    return row;
  }

  async list(loopId: string) {
    const rows = await this.auditRepo.listByLoop(loopId);
    return rows.map((r) => ({
      id: r.id,
      loopId: r.loop_id,
      agent: r.agent ?? undefined,
      action: r.action,
      detail: r.detail,
      createdAt: r.created_at.toISOString(),
    }));
  }
}
