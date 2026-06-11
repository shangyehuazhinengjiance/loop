import { Injectable } from '@nestjs/common';
import { AgentCoordinator } from '../agent/agent-coordinator.js';
import { ChatService } from '../chat/chat.service.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { PhaseService } from '../phase/phase.service.js';

/** 成员进入 Loop 时：启动阶段机并触发 PM（阅读项目总结 / 熟悉导入需求） */
@Injectable()
export class LoopEntryService {
  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly phaseService: PhaseService,
    private readonly agentCoordinator: AgentCoordinator,
    private readonly chatService: ChatService,
  ) {}

  async onMemberJoined(loopId: string, userId?: string): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) return;

    if (loop.phase === 'created') {
      await this.phaseService.start(loopId);
      return;
    }

    if (loop.phase !== 'requirement' || loop.context.prd) {
      return;
    }

    if (await this.hasPmEngaged(loopId)) {
      return;
    }

    await this.agentCoordinator.activate(loopId, 'pm', {
      reason: 'loop_entry',
      userId,
    });
  }

  private async hasPmEngaged(loopId: string): Promise<boolean> {
    const messages = await this.chatService.listMessages(loopId);
    return messages.some(
      (m) => m.sender.id === 'pm-agent' && m.phase === 'requirement',
    );
  }
}
