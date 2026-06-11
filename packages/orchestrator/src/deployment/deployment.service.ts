import {
  buildAgentFailureMessage,
  failureMentions,
  pickNotifyMember,
  suggestAssignee,
} from '@loop/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ChatService } from '../chat/chat.service.js';
import { LoopMemberRepository } from '../db/repositories/loop-member.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ProjectRepository } from '../db/repositories/project.repository.js';
import { GitService } from '../git/git.service.js';
import { MergeRequestService } from '../git/merge-request.service.js';

@Injectable()
export class DeploymentService {
  constructor(
    private readonly gitService: GitService,
    private readonly loopRepo: LoopRepository,
    private readonly memberRepo: LoopMemberRepository,
    private readonly chatService: ChatService,
    private readonly mergeRequestService: MergeRequestService,
    private readonly projectRepo: ProjectRepository,
  ) {}

  /**
   * 部署阶段：推送 loop 分支并创建 MR → test，@ 合并负责人。
   */
  async submitToTestBranch(
    loopId: string,
    approvedBy?: string,
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) return;

    const members = await this.memberRepo.listByLoop(loopId);
    let mergeAssignee = pickNotifyMember(members, {
      preferUserId: approvedBy,
      skillsHint:
        process.env.DEPLOY_MERGE_SKILLS ?? '运维 合并 MR 代码评审',
    });
    if (!mergeAssignee && approvedBy) {
      mergeAssignee =
        members.find((m) => m.userId === approvedBy) ?? members[0] ?? null;
    }
    const targetBranch = process.env.DEPLOY_TARGET_BRANCH?.trim() || 'test';
    const headBranch = loop.git_branch ?? `loop/${loopId}`;

    this.chatService.emitProcessing({
      loopId,
      active: true,
      label: '正在创建合并请求…',
    });

    try {
      const projectEntity = await this.projectRepo.findById(loop.project_id);
      const gitConfig = projectEntity?.git_config as {
        remoteUrl?: string;
        credentialRef?: string;
      } | undefined;

      if (!gitConfig?.remoteUrl) {
        throw new Error('项目未配置 gitConfig.remoteUrl');
      }

      const devMode = loop.context.development?.mode;
      if (devMode !== 'external') {
        await this.gitService.commitWorkspace(
          loopId,
          `loop ${loopId}: development complete`,
        );
        await this.gitService.pushLoopBranch(loopId);
      }

      const mr = await this.mergeRequestService.createOrGetMergeRequest({
        remoteUrl: gitConfig.remoteUrl,
        credentialRef: gitConfig.credentialRef ?? 'GIT_ACCESS_TOKEN',
        headBranch,
        baseBranch: targetBranch,
        title: `loop ${loopId}: ${loop.title}`,
        body: [
          `## Loop 部署合并请求`,
          '',
          `- Loop ID: \`${loopId}\``,
          `- 标题: ${loop.title}`,
          `- 源分支: \`${headBranch}\``,
          `- 目标分支: \`${targetBranch}\``,
          devMode === 'external' ? '- 开发方式: 外部工具' : '- 开发方式: Loop Dev Agent',
          '',
          '由 AI Native Loop Orchestrator 自动创建。',
        ].join('\n'),
      });

      const now = new Date().toISOString();
      await this.loopRepo.updateContext(loopId, {
        ...loop.context,
        deployment: {
          ...loop.context.deployment,
          status: 'pending',
          step: 'awaiting_mr_merge',
          targetBranch,
          mergeRequest: mr,
          mergeAssigneeUserId: mergeAssignee?.userId,
          mergeAssigneeDisplayName: mergeAssignee?.displayName,
        },
      });

      if (mergeAssignee) {
        const blocker = {
          kind: 'human_decision' as const,
          phase: 'deployment' as const,
          reason: `等待合并 MR：\`${headBranch}\` → \`${targetBranch}\``,
          question: mr.url,
          assigneeUserId: mergeAssignee.userId,
          assigneeDisplayName: mergeAssignee.displayName,
          requestedBy: 'orchestrator' as const,
          createdAt: now,
        };
        await this.loopRepo.updateBlocker(loopId, blocker, 'blocked');
      }

      const mention = mergeAssignee
        ? `@${mergeAssignee.userId}（${mergeAssignee.displayName}）`
        : suggestAssignee(members, '运维')
          ? `@${suggestAssignee(members, '运维')!.userId}`
          : '**已加入成员中的运维同事**';

      const body = [
        '## 请合并 MR 到测试分支',
        '',
        `- MR：[${mr.provider === 'gitlab' ? '!' : '#'}${mr.number}](${mr.url})`,
        `- 源分支：\`${headBranch}\``,
        `- 目标分支：\`${targetBranch}\``,
        '',
        `请 ${mention} 在 Git 平台 **Review 并合并** 该 MR。`,
        '',
        '合并完成后，回到 Loop 点击下方「MR 已合并」；再手动触发 CI/CD，流水线通过后点击「流水线已完成」。',
      ].join('\n');

      await this.chatService.publishAgentMessage({
        loopId,
        phase: 'deployment',
        agentId: 'orchestrator',
        content: {
          type: 'artifact',
          body,
          mentions: mergeAssignee ? failureMentions(mergeAssignee) : undefined,
          actions: [
            {
              id: 'confirm-mr-merged',
              label: 'MR 已合并',
              action: 'confirm_mr_merged',
            },
          ],
        },
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const fallback = pickNotifyMember(members, {
        preferUserId: approvedBy,
        skillsHint: '运维 CI 流水线',
      });
      await this.chatService.publishAgentMessage({
        loopId,
        phase: 'deployment',
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: buildAgentFailureMessage({
            agentLabel: '部署',
            reason: `创建 MR（\`${headBranch}\` → \`${targetBranch}\`）失败：${detail}`,
            member: fallback,
            hints: [
              '配置 GIT_ACCESS_TOKEN（需 repo / api 权限）',
              '确认远程存在源分支并已 push',
              `确认目标分支 \`${targetBranch}\` 存在`,
              'GitHub 企业版可设置 GITHUB_API_BASE',
            ],
          }),
          mentions: failureMentions(fallback),
        },
      });
    } finally {
      this.chatService.emitProcessing({ loopId, active: false });
    }
  }

  async confirmMrMerged(input: {
    loopId: string;
    userId: string;
    note?: string;
  }): Promise<void> {
    const loop = await this.loopRepo.findById(input.loopId);
    if (!loop) throw new NotFoundException('Loop not found');
    if (loop.phase !== 'deployment') {
      throw new BadRequestException('当前不在 deployment 阶段');
    }

    const dep = loop.context.deployment;
    if (dep?.step !== 'awaiting_mr_merge') {
      throw new BadRequestException('当前不在等待 MR 合并状态');
    }
    if (dep.mergeAssigneeUserId && dep.mergeAssigneeUserId !== input.userId) {
      throw new BadRequestException('仅被指派的合并负责人可确认 MR 已合并');
    }

    const members = await this.memberRepo.listByLoop(input.loopId);
    const pipelineAssignee = pickNotifyMember(members, {
      skillsHint:
        process.env.DEPLOY_PIPELINE_SKILLS ?? '运维 CI 流水线 K8s',
    });

    const now = new Date().toISOString();
    await this.loopRepo.updateContext(input.loopId, {
      ...loop.context,
      deployment: {
        ...dep,
        step: 'awaiting_pipeline',
        mrMergedAt: now,
        mrMergedBy: input.userId,
        status: 'pending',
      },
    });
    await this.loopRepo.updateBlocker(input.loopId, null, 'active');

    const mention = pipelineAssignee
      ? `@${pipelineAssignee.userId}（${pipelineAssignee.displayName}）`
      : '**运维同事**';

    const mr = dep.mergeRequest;
    const body = [
      '## MR 已合并，请跑流水线',
      '',
      mr ? `- MR：[链接](${mr.url})` : '',
      `- 目标分支：\`${dep.targetBranch ?? 'test'}\``,
      input.note ? `- 备注：${input.note}` : '',
      '',
      `请 ${mention} **手动触发 CI/CD 流水线**完成部署验证。`,
      '',
      '流水线跑通后，点击下方「流水线已完成」结束本 Loop。',
    ]
      .filter(Boolean)
      .join('\n');

    await this.chatService.publishAgentMessage({
      loopId: input.loopId,
      phase: 'deployment',
      agentId: 'orchestrator',
      content: {
        type: 'artifact',
        body,
        mentions: pipelineAssignee
          ? failureMentions(pipelineAssignee)
          : undefined,
        actions: [
          {
            id: 'approve-deploy',
            label: '流水线已完成',
            action: 'approve_deploy',
          },
        ],
      },
    });
  }
}
