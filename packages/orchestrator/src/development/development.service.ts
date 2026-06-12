import {
  failureMentions,
  suggestAssignee,
  type DevelopmentConfig,
  type DevelopmentMode,
  type ExternalDevelopmentInfo,
  type LoopContext,
} from '@loop/shared';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgentCoordinator } from '../agent/agent-coordinator.js';
import { ApprovalRepository } from '../db/repositories/approval.repository.js';
import { LoopMemberRepository } from '../db/repositories/loop-member.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ChatService } from '../chat/chat.service.js';
import { PhaseService } from '../phase/phase.service.js';
import { PrdPublishService } from './prd-publish.service.js';

@Injectable()
export class DevelopmentService {
  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly memberRepo: LoopMemberRepository,
    private readonly approvalRepo: ApprovalRepository,
    private readonly chatService: ChatService,
    private readonly prdPublish: PrdPublishService,
    private readonly agentCoordinator: AgentCoordinator,
    private readonly phaseService: PhaseService,
  ) {}

  async getPrdApprovedBy(loopId: string): Promise<string | null> {
    const rows = await this.approvalRepo.listByLoop(loopId);
    const prdApprovals = rows.filter((r) => r.action === 'approve_prd');
    const last = prdApprovals[prdApprovals.length - 1];
    return last?.approved_by ?? null;
  }

  /** PRD 确认后进入 development：等待 PRD 确认人选择开发模式 */
  async onEnterDevelopment(
    loopId: string,
    prdApprovedBy: string,
    opts?: { reprompt?: boolean },
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop || loop.phase !== 'development') return;

    const development: DevelopmentConfig = {
      prdApprovedBy,
      ...(opts?.reprompt ? {} : loop.context.development),
      mode: undefined,
      external: undefined,
    };

    await this.loopRepo.updateContext(loopId, {
      ...loop.context,
      development,
    });
    await this.loopRepo.updateBlocker(loopId, null, 'active');

    await this.chatService.publishAgentMessage({
      loopId,
      phase: 'development',
      agentId: 'orchestrator',
      content: {
        type: 'artifact',
        body: [
          '## 请选择开发方式',
          '',
          'PRD 已确认。请 **PRD 确认人** 选择本 Loop 的开发方式：',
          '',
          '- **Loop 内 Dev Agent**：在 Loop 工作区由 @dev-agent 自动开发',
          '- **外部工具**：将 PRD 发布到 Git 分支后，交由指定成员用 Cursor / IDE 等开发',
        ].join('\n'),
        actions: [
          {
            id: 'select-dev-agent',
            label: '由 Dev Agent 在 Loop 内开发',
            action: 'select_dev_mode_agent',
          },
          {
            id: 'select-dev-external',
            label: '使用外部工具开发',
            action: 'select_dev_mode_external',
          },
        ],
      },
    });
  }

  async selectMode(input: {
    loopId: string;
    mode: DevelopmentMode;
    userId: string;
    assigneeUserId?: string;
  }): Promise<void> {
    const loop = await this.loopRepo.findById(input.loopId);
    if (!loop) throw new NotFoundException('Loop not found');
    if (loop.phase !== 'development') {
      throw new BadRequestException('当前不在 development 阶段');
    }

    const dev = loop.context.development;
    if (dev?.mode) {
      throw new BadRequestException(`开发模式已选择为 ${dev.mode}`);
    }

    const prdApprovedBy = dev?.prdApprovedBy ?? (await this.getPrdApprovedBy(input.loopId));
    if (!prdApprovedBy) {
      throw new BadRequestException('未找到 PRD 确认人');
    }
    if (input.userId !== prdApprovedBy) {
      throw new ForbiddenException('仅 PRD 确认人可选择开发模式');
    }

    if (input.mode === 'agent') {
      await this.startAgentMode(input.loopId, loop.context, prdApprovedBy);
      return;
    }

    await this.startExternalMode(input.loopId, loop, prdApprovedBy, input.assigneeUserId);
  }

  private async startAgentMode(
    loopId: string,
    context: LoopContext,
    prdApprovedBy: string,
  ): Promise<void> {
    await this.loopRepo.updateContext(loopId, {
      ...context,
      development: {
        prdApprovedBy,
        mode: 'agent',
      },
    });

    await this.chatService.publishAgentMessage({
      loopId,
      phase: 'development',
      agentId: 'orchestrator',
      content: {
        type: 'text',
        body: '已选择 **Loop 内 Dev Agent** 开发。正在启动 Dev Agent…',
      },
    });

    await this.agentCoordinator.activate(loopId, 'dev', {
      reason: 'manual',
      userId: prdApprovedBy,
    });
  }

  private async startExternalMode(
    loopId: string,
    loop: Awaited<ReturnType<LoopRepository['findById']>>,
    prdApprovedBy: string,
    assigneeUserId?: string,
  ): Promise<void> {
    if (!loop) return;

    const members = await this.memberRepo.listByLoop(loopId);
    let assignee = assigneeUserId
      ? await this.memberRepo.find(loopId, assigneeUserId)
      : null;
    if (assigneeUserId && !assignee) {
      throw new BadRequestException(`成员 ${assigneeUserId} 未加入本 Loop`);
    }
    if (!assignee) {
      assignee = suggestAssignee(members, '开发 前端 后端 全栈 编程');
    }
    if (!assignee) {
      throw new BadRequestException('暂无成员可指派，请先加入 Loop 并填写专长');
    }

    this.chatService.emitProcessing({
      loopId,
      active: true,
      label: '正在发布 PRD 到 GitHub…',
    });

    try {
      const published = await this.prdPublish.publishForExternalDev({
        loopId,
        assigneeUserId: assignee.userId,
        assigneeDisplayName: assignee.displayName,
      });

      const branch = published.branch;
      const now = new Date().toISOString();
      const development: DevelopmentConfig = {
        prdApprovedBy,
        mode: 'external',
        external: {
          assigneeUserId: assignee.userId,
          assigneeDisplayName: assignee.displayName,
          prdCommitSha: published.commitSha,
          prdPushedAt: now,
          handoffAt: now,
          targetBranch: branch,
        },
      };

      await this.loopRepo.updateContext(loopId, {
        ...loop.context,
        development,
      });

      const blocker = {
        kind: 'external' as const,
        phase: 'development' as const,
        reason: `等待 @${assignee.displayName} 在外部工具完成开发（分支 \`${branch}\`）`,
        assigneeUserId: assignee.userId,
        assigneeDisplayName: assignee.displayName,
        requestedBy: 'orchestrator' as const,
        createdAt: now,
      };
      await this.loopRepo.updateBlocker(loopId, blocker, 'blocked');

      await this.publishExternalDevHandoff(loopId, development.external!, {
        remoteUrl: published.remoteUrl,
      });
    } finally {
      this.chatService.emitProcessing({ loopId, active: false });
    }
  }

  /** PRD 修订确认后，恢复外部工具开发阻塞并重新发布交接卡（含「开发完成」按钮） */
  async resumeExternalDevAfterPrdRevision(loopId: string): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop || loop.phase !== 'development') return;

    const dev = loop.context.development;
    const external = dev?.external;
    if (dev?.mode !== 'external' || !external) return;

    const branch = external.targetBranch;
    const blocker = {
      kind: 'external' as const,
      phase: 'development' as const,
      reason: `等待 @${external.assigneeDisplayName} 在外部工具完成开发（分支 \`${branch}\`）`,
      assigneeUserId: external.assigneeUserId,
      assigneeDisplayName: external.assigneeDisplayName,
      requestedBy: 'orchestrator' as const,
      createdAt: new Date().toISOString(),
    };
    await this.loopRepo.updateBlocker(loopId, blocker, 'blocked');

    await this.publishExternalDevHandoff(loopId, external, {
      headline: '## 开发交接（外部工具）— 已恢复',
    });
  }

  private async publishExternalDevHandoff(
    loopId: string,
    external: ExternalDevelopmentInfo,
    opts?: { remoteUrl?: string; headline?: string },
  ): Promise<void> {
    const branch = external.targetBranch;
    const assignee = {
      userId: external.assigneeUserId,
      displayName: external.assigneeDisplayName,
    };
    const repoLine = opts?.remoteUrl
      ? `- 仓库：\`${opts.remoteUrl}\``
      : '- 仓库：见项目 Git 配置';

    const lines = [
      opts?.headline ?? '## 开发交接（外部工具）',
      '',
      repoLine,
      `- 分支：\`${branch}\``,
      `- PRD 路径：\`docs/loop/${loopId}/PRD.md\``,
    ];
    if (external.prdCommitSha) {
      lines.push(`- 提交：\`${external.prdCommitSha.slice(0, 8)}\``);
    }
    lines.push(
      '',
      `请 @${assignee.userId}（${assignee.displayName}）使用外部工具完成开发，**push 到 \`${branch}\`** 后点击下方按钮。`,
      '',
      '> 仅被指派的负责人可确认「开发完成」。',
    );

    await this.chatService.publishAgentMessage({
      loopId,
      phase: 'development',
      agentId: 'orchestrator',
      content: {
        type: 'artifact',
        body: lines.join('\n'),
        mentions: failureMentions(assignee),
        actions: [
          {
            id: 'complete-external-dev',
            label: '开发完成，进入部署',
            action: 'complete_external_dev',
          },
        ],
      },
    });
  }

  async completeExternal(input: {
    loopId: string;
    userId: string;
    note?: string;
  }): Promise<void> {
    const loop = await this.loopRepo.findById(input.loopId);
    if (!loop) throw new NotFoundException('Loop not found');
    if (loop.phase !== 'development') {
      throw new BadRequestException('当前不在 development 阶段');
    }

    const dev = loop.context.development;
    if (dev?.mode !== 'external' || !dev.external) {
      throw new BadRequestException('当前不是外部工具开发模式');
    }

    if (input.userId !== dev.external.assigneeUserId) {
      throw new ForbiddenException('仅被指派的开发负责人可确认开发完成');
    }

    await this.loopRepo.updateContext(input.loopId, {
      ...loop.context,
      development: {
        ...dev,
        external: {
          ...dev.external,
          completedAt: new Date().toISOString(),
          completedBy: input.userId,
        },
      },
    });

    await this.loopRepo.updateBlocker(input.loopId, null, 'active');

    await this.chatService.publishAgentMessage({
      loopId: input.loopId,
      phase: 'development',
      agentId: 'orchestrator',
      content: {
        type: 'text',
        body: `@${dev.external.assigneeDisplayName} 已确认外部开发完成${input.note ? `：${input.note}` : ''}，进入部署阶段…`,
      },
    });

    const exists = await this.approvalRepo.hasApprovalInPhase(
      input.loopId,
      'approve_dev',
      loop.phase,
    );
    if (!exists) {
      await this.approvalRepo.create({
        loopId: input.loopId,
        action: 'approve_dev',
        approvedBy: input.userId,
        phase: loop.phase,
        note: input.note,
      });
    }
    await this.phaseService.approve(
      input.loopId,
      'approve_dev',
      input.userId,
      input.note,
    );
  }
}
