import type { GitPendingOperation, GitPendingRetry } from '@loop/shared';
import { pickNotifyMember } from '@loop/shared';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { BlockerService } from '../blocker/blocker.service.js';
import { ChatService } from '../chat/chat.service.js';
import { LoopMemberRepository } from '../db/repositories/loop-member.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { DeploymentService } from '../deployment/deployment.service.js';
import { LoopDotLoopService } from '../loop-context/loop-dot-loop.service.js';
import { GitService } from './git.service.js';
import { isGitSyncConflictError } from './git-sync-conflict.error.js';

export interface ReportGitConflictInput {
  branch: string;
  detail: string;
  retry: GitPendingRetry;
  preferUserId?: string;
}

@Injectable()
export class GitContinueService {
  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly memberRepo: LoopMemberRepository,
    private readonly blockerService: BlockerService,
    private readonly chatService: ChatService,
    private readonly gitService: GitService,
    @Inject(forwardRef(() => LoopDotLoopService))
    private readonly loopDotLoop: LoopDotLoopService,
    @Inject(forwardRef(() => DeploymentService))
    private readonly deployment: DeploymentService,
  ) {}

  async reportConflict(loopId: string, input: ReportGitConflictInput): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) throw new NotFoundException('Loop not found');

    const members = await this.memberRepo.listByLoop(loopId);
    const assignee = pickNotifyMember(members, {
      preferUserId: input.preferUserId,
      skillsHint:
        process.env.GIT_CONFLICT_SKILLS ??
        process.env.DEPLOY_MERGE_SKILLS ??
        '开发 Git 合并 rebase',
    });

    const gitPending: GitPendingOperation = {
      retry: input.retry,
      branch: input.branch,
      errorDetail: input.detail.slice(0, 500),
      createdAt: new Date().toISOString(),
      assigneeUserId: assignee?.userId,
      assigneeDisplayName: assignee?.displayName,
    };

    await this.loopRepo.updateContext(loopId, {
      ...loop.context,
      gitPending,
    });

    await this.blockerService.requestHumanHelp({
      loopId,
      kind: 'human_fix',
      reason: `Git 同步冲突：分支 \`${input.branch}\``,
      question: [
        input.detail,
        '',
        '请在仓库工作区或 Git 平台**解决冲突**后，点击「冲突已解决，继续」由系统自动重试推送。',
      ].join('\n'),
      assigneeUserId: assignee?.userId,
      skillsHint:
        process.env.GIT_CONFLICT_SKILLS ??
        process.env.DEPLOY_MERGE_SKILLS ??
        '开发 Git 合并 rebase',
      requestedBy: 'orchestrator',
    });
  }

  async continueAfterConflict(
    loopId: string,
    userId: string,
  ): Promise<{ ok: boolean; message: string }> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) throw new NotFoundException('Loop not found');

    const pending = loop.context.gitPending;
    if (!pending) {
      throw new BadRequestException('当前没有待继续的 Git 操作');
    }

    const assigneeId = pending.assigneeUserId ?? loop.blocker?.assigneeUserId;
    if (assigneeId && assigneeId !== userId) {
      throw new BadRequestException(
        `仅 @${pending.assigneeDisplayName ?? assigneeId} 可继续 Git 同步`,
      );
    }

    const retry = pending.retry;
    await this.loopRepo.updateContext(loopId, {
      ...loop.context,
      gitPending: undefined,
    });
    if (loop.blocker) {
      await this.loopRepo.updateBlocker(loopId, null, 'active');
    }

    try {
      switch (retry.type) {
        case 'loop_dot_loop_push_mr':
          await this.loopDotLoop.continueAfterGitConflict(loopId, retry.completedBy);
          break;
        case 'deployment_push_mr':
          await this.deployment.continueAfterGitConflict(loopId, retry.approvedBy);
          break;
        case 'push_only':
          await this.gitService.pushLoopBranch(loopId);
          await this.chatService.publishAgentMessage({
            loopId,
            phase: loop.phase,
            agentId: 'orchestrator',
            content: {
              type: 'text',
              body: `✅ Git 推送已成功（分支 \`${pending.branch}\`）。`,
            },
          });
          break;
      }
      return { ok: true, message: 'Git 同步已继续' };
    } catch (err) {
      if (isGitSyncConflictError(err)) {
        await this.reportConflict(loopId, {
          branch: err.branch,
          detail: err.detail || err.message,
          retry,
          preferUserId: userId,
        });
      }
      throw err;
    }
  }
}
