import type {
  AgentRole,
  BlockerAgentId,
  BlockerKind,
  LoopBlocker,
} from '@loop/shared';
import { suggestAssignee } from '@loop/shared';
import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { AgentCoordinator } from '../agent/agent-coordinator.js';
import { ChatService } from '../chat/chat.service.js';
import { LoopMemberRepository } from '../db/repositories/loop-member.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';

export interface RequestBlockerInput {
  loopId: string;
  kind: BlockerKind;
  reason: string;
  question?: string;
  assigneeUserId?: string;
  skillsHint?: string;
  requestedBy: BlockerAgentId;
}

@Injectable()
export class BlockerService implements OnModuleInit {
  private reminderTimer?: ReturnType<typeof setInterval>;
  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly memberRepo: LoopMemberRepository,
    private readonly chatService: ChatService,
    private readonly agentCoordinator: AgentCoordinator,
  ) {}

  onModuleInit() {
    const hours = parseFloat(process.env.BLOCKER_REMINDER_HOURS ?? '24');
    if (hours <= 0) return;
    const ms = Math.max(hours, 1) * 60 * 60 * 1000;
    this.reminderTimer = setInterval(() => {
      void this.sendBlockerReminders(ms);
    }, Math.min(ms, 15 * 60 * 1000));
  }

  async requestHumanHelp(input: RequestBlockerInput): Promise<LoopBlocker> {
    const loop = await this.loopRepo.findById(input.loopId);
    if (!loop) throw new NotFoundException('Loop not found');

    const assigneeUserId = await this.resolveAssignee(
      input.loopId,
      input.assigneeUserId,
      input.skillsHint,
    );
    const member = await this.memberRepo.find(input.loopId, assigneeUserId);
    if (!member) {
      throw new BadRequestException(
        `成员 ${assigneeUserId} 未加入本 Loop，无法 @。仅可指派已加入成员。`,
      );
    }

    const blocker: LoopBlocker = {
      kind: input.kind,
      phase: loop.phase,
      reason: input.reason,
      question: input.question,
      assigneeUserId: member.userId,
      assigneeDisplayName: member.displayName,
      requestedBy: input.requestedBy,
      createdAt: new Date().toISOString(),
    };

    await this.loopRepo.updateBlocker(input.loopId, blocker, 'blocked');

    const agentRole = this.agentIdToRole(input.requestedBy);
    if (agentRole) {
      await this.agentCoordinator.cancel(input.loopId, agentRole);
    }

    const body = [
      `⏸ **等待人工协助**（${input.kind}）`,
      `@${member.userId} ${member.displayName}`,
      input.reason,
      input.question ? `\n> ${input.question}` : '',
      '\n处理完成后请点击「已解决」或由被指派人解除阻塞。',
    ]
      .filter(Boolean)
      .join('\n');

    await this.chatService.publishAgentMessage({
      loopId: input.loopId,
      phase: loop.phase,
      agentId: input.requestedBy,
      content: { type: 'text', body },
    });

    return blocker;
  }

  async resolve(input: {
    loopId: string;
    userId: string;
    note?: string;
  }): Promise<LoopBlocker | null> {
    const loop = await this.loopRepo.findById(input.loopId);
    if (!loop?.blocker) {
      throw new BadRequestException('当前没有阻塞项');
    }

    const resolved: LoopBlocker = {
      ...loop.blocker,
      resolvedAt: new Date().toISOString(),
      resolvedBy: input.userId,
    };

    await this.loopRepo.updateBlocker(input.loopId, null, 'active');

    await this.chatService.publishAgentMessage({
      loopId: input.loopId,
      phase: loop.phase,
      agentId: 'orchestrator',
      content: {
        type: 'text',
        body: `✅ 阻塞已解除（by ${input.userId}${input.note ? `：${input.note}` : ''}）。可继续 @Agent 推进流程。`,
      },
    });

    const resumeAgent = this.agentIdToRole(resolved.requestedBy);
    if (resumeAgent) {
      await this.agentCoordinator.activate(input.loopId, resumeAgent, {
        reason: 'manual',
        userId: input.userId,
      });
    }

    return resolved;
  }

  private async resolveAssignee(
    loopId: string,
    assigneeUserId?: string,
    skillsHint?: string,
  ): Promise<string> {
    if (assigneeUserId?.trim()) {
      return assigneeUserId.trim();
    }
    const members = await this.memberRepo.listByLoop(loopId);
    const picked = suggestAssignee(members, skillsHint);
    if (!picked) {
      throw new BadRequestException(
        '无法匹配成员：请指定 assignee_user_id，或确保 Loop 内已有成员（bio 空者为万能接应）',
      );
    }
    return picked.userId;
  }

  private async sendBlockerReminders(intervalMs: number): Promise<void> {
    const loops = await this.loopRepo.listByStatus('blocked');
    const now = Date.now();
    for (const loop of loops) {
      if (!loop.blocker) continue;
      const created = new Date(loop.blocker.createdAt).getTime();
      const last = loop.blocker.lastReminderAt
        ? new Date(loop.blocker.lastReminderAt).getTime()
        : created;
      if (now - last < intervalMs) continue;

      const updated: LoopBlocker = {
        ...loop.blocker,
        lastReminderAt: new Date().toISOString(),
      };
      await this.loopRepo.updateBlocker(loop.id, updated, 'blocked');

      await this.chatService.publishAgentMessage({
        loopId: loop.id,
        phase: loop.phase,
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: `⏰ 提醒：仍等待 @${loop.blocker.assigneeDisplayName}（${loop.blocker.assigneeUserId}）处理：${loop.blocker.reason}`,
        },
      });
    }
  }

  private agentIdToRole(agentId: BlockerAgentId): AgentRole | null {
    if (agentId === 'pm-agent') return 'pm';
    if (agentId === 'dev-agent') return 'dev';
    if (agentId === 'ops-agent') return 'ops';
    return null;
  }
}
