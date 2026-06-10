import {
  buildAgentFailureMessage,
  failureMentions,
  pickNotifyMember,
  suggestAssignee,
} from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { ChatService } from '../chat/chat.service.js';
import { LoopMemberRepository } from '../db/repositories/loop-member.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { GitService } from '../git/git.service.js';

@Injectable()
export class DeploymentService {
  constructor(
    private readonly gitService: GitService,
    private readonly loopRepo: LoopRepository,
    private readonly memberRepo: LoopMemberRepository,
    private readonly chatService: ChatService,
  ) {}

  /**
   * 部署阶段：提交并推送到 test 分支，@ 运维成员手动跑流水线。
   */
  async submitToTestBranch(
    loopId: string,
    approvedBy?: string,
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) return;

    const members = await this.memberRepo.listByLoop(loopId);
    const pipelineAssignee = pickNotifyMember(members, {
      skillsHint:
        process.env.DEPLOY_PIPELINE_SKILLS ?? '运维 CI 流水线 K8s',
    });
    const targetBranch = process.env.DEPLOY_TARGET_BRANCH?.trim() || 'test';
    const commitMessage = `loop ${loopId}: ${loop.title}`;

    try {
      const { commitSha, hadChanges } = await this.gitService.commitAndPushToBranch(
        loopId,
        targetBranch,
        commitMessage,
      );

      await this.loopRepo.updateContext(loopId, {
        ...loop.context,
        deployment: {
          ...loop.context.deployment,
          status: 'pending',
          targetBranch,
          commitSha,
        },
      });

      const mention = pipelineAssignee
        ? `@${pipelineAssignee.userId}（${pipelineAssignee.displayName}）`
        : suggestAssignee(members, '运维')
          ? `@${suggestAssignee(members, '运维')!.userId}`
          : '**已加入成员中的运维同事**';

      const body = [
        '## 代码已推送到测试分支',
        '',
        `- 分支：\`${targetBranch}\``,
        `- 提交：\`${commitSha.slice(0, 8)}\`${hadChanges ? '' : '（无新改动，推送当前 HEAD）'}`,
        '',
        `请 ${mention} **手动触发 CI/CD 流水线**完成部署验证。`,
        '',
        '流水线跑通后，点击下方「流水线已完成」结束本 Loop。',
      ].join('\n');

      await this.chatService.publishAgentMessage({
        loopId,
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
            reason: `推送到 \`${targetBranch}\` 失败：${detail}`,
            member: fallback,
            hints: [
              '检查 GIT_SSH_KEY_PATH / GIT_ACCESS_TOKEN 与项目 remoteUrl',
              `确认远程存在并可写 \`${targetBranch}\` 分支`,
              '工作区需已 initLoopWorkspace 且 Dev 改动已保存',
            ],
          }),
          mentions: failureMentions(fallback),
        },
      });
    }
  }
}
