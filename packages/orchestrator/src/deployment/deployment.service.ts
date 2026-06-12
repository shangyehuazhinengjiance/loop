import {
  buildAgentFailureMessage,
  failureMentions,
  pickNotifyMember,
  productionBranch,
  resolveDeploymentExecution,
  suggestAssignee,
  testBranch,
  type DeploymentExecutionMode,
  type LoopMember,
} from '@loop/shared';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { AgentCoordinator } from '../agent/agent-coordinator.js';
import { ChatService } from '../chat/chat.service.js';
import { LoopMemberRepository } from '../db/repositories/loop-member.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ProjectRepository } from '../db/repositories/project.repository.js';
import { GitService } from '../git/git.service.js';
import { isGitSyncConflictError } from '../git/git-sync-conflict.error.js';
import {
  isNoCommitsBetweenBranchesError,
  MergeRequestService,
} from '../git/merge-request.service.js';
import { SecretManager } from '../git/secret-manager.js';

const require = createRequire(fileURLToPath(import.meta.url));

type GitContinueService = import('../git/git-continue.service.js').GitContinueService;

@Injectable()
export class DeploymentService {
  constructor(
    private readonly gitService: GitService,
    @Inject(forwardRef(() => require('../git/git-continue.service.js').GitContinueService))
    private readonly gitContinue: GitContinueService,
    private readonly loopRepo: LoopRepository,
    private readonly memberRepo: LoopMemberRepository,
    private readonly chatService: ChatService,
    private readonly mergeRequestService: MergeRequestService,
    private readonly projectRepo: ProjectRepository,
    private readonly agentCoordinator: AgentCoordinator,
    private readonly secretManager: SecretManager,
  ) {}

  /** Git 冲突解决后：仅 push 并创建测试分支 MR */
  async continueAfterGitConflict(
    loopId: string,
    approvedBy?: string,
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) return;

    const devMode = loop.context.development?.mode;
    this.chatService.emitProcessing({
      loopId,
      active: true,
      label: '正在继续 Git 推送与 MR 创建…',
    });

    try {
      if (devMode !== 'external') {
        await this.gitService.pushLoopBranch(loopId);
      }
      await this.createTestBranchMrAndNotify(loopId, approvedBy);
    } finally {
      this.chatService.emitProcessing({ loopId, active: false });
    }
  }

  /**
   * 部署阶段：创建 loop → test MR，@ 合并负责人（不启动 Ops Agent，除非项目为 agent 模式）。
   */
  async submitToTestBranch(
    loopId: string,
    approvedBy?: string,
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) return;

    const members = await this.memberRepo.listByLoop(loopId);
    const headBranch = loop.git_branch ?? `loop/${loopId}`;

    this.chatService.emitProcessing({
      loopId,
      active: true,
      label: '正在创建合并请求…',
    });

    try {
      const projectEntity = await this.projectRepo.findById(loop.project_id);
      const gitConfig = projectEntity?.git_config as Record<string, unknown> | undefined;
      if (!gitConfig?.remoteUrl) {
        throw new Error('项目未配置 gitConfig.remoteUrl');
      }

      const devMode = loop.context.development?.mode;
      if (devMode !== 'external') {
        await this.gitService.commitWorkspace(
          loopId,
          `loop ${loopId}: development complete`,
        );
        try {
          await this.gitService.pushLoopBranch(loopId);
        } catch (err) {
          if (isGitSyncConflictError(err)) {
            await this.gitContinue.reportConflict(loopId, {
              branch: err.branch,
              detail: err.detail || err.message,
              retry: { type: 'deployment_push_mr', approvedBy },
              preferUserId: approvedBy,
            });
            return;
          }
          throw err;
        }
      }

      await this.createTestBranchMrAndNotify(loopId, approvedBy);
    } catch (err) {
      if (isGitSyncConflictError(err)) return;
      const detail = err instanceof Error ? err.message : String(err);
      const targetBranch = testBranch();
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

    const mode = dep.executionMode ?? 'manual';
    const now = new Date().toISOString();
    await this.loopRepo.updateBlocker(input.loopId, null, 'active');

    if (mode === 'agent') {
      await this.loopRepo.updateContext(input.loopId, {
        ...loop.context,
        deployment: {
          ...dep,
          step: 'awaiting_test_deploy',
          mrMergedAt: now,
          mrMergedBy: input.userId,
          status: 'pending',
          executionMode: mode,
        },
      });
      const mr = dep.mergeRequest;
      await this.chatService.publishAgentMessage({
        loopId: input.loopId,
        phase: 'deployment',
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: [
            '## MR 已合并',
            '',
            mr ? `- MR：[链接](${mr.url})` : '',
            `- 目标分支：\`${dep.targetBranch ?? 'test'}\``,
            input.note ? `- 备注：${input.note}` : '',
            '',
            '正在启动 **Ops Agent** 部署测试环境…',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      });
      await this.triggerOpsDeploy(input.loopId, input.userId, 'test');
      return;
    }

    await this.enterManualTestDeploy(input.loopId, input.userId, input.note);
  }

  /** manual：测试 MR 已合并，通知人工部署测试环境 */
  private async enterManualTestDeploy(
    loopId: string,
    userId: string,
    note?: string,
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop?.context.deployment) return;

    const members = await this.memberRepo.listByLoop(loopId);
    const deployAssignee = pickNotifyMember(members, {
      preferUserId: userId,
      skillsHint:
        process.env.DEPLOY_PIPELINE_SKILLS ?? '运维 CI 流水线 K8s 部署',
    });

    const dep = loop.context.deployment;
    const now = new Date().toISOString();
    await this.loopRepo.updateContext(loopId, {
      ...loop.context,
      deployment: {
        ...dep,
        step: 'awaiting_manual_test_deploy',
        mrMergedAt: dep.mrMergedAt ?? now,
        deployAssigneeUserId: deployAssignee?.userId,
        deployAssigneeDisplayName: deployAssignee?.displayName,
        testApproverUserId: deployAssignee?.userId,
        testApproverDisplayName: deployAssignee?.displayName,
      },
    });

    const mention = this.formatMention(deployAssignee, members, '运维');
    const mr = dep.mergeRequest;
    await this.chatService.publishAgentMessage({
      loopId,
      phase: 'deployment',
      agentId: 'orchestrator',
      content: {
        type: 'artifact',
        body: [
          '## 请部署并验证测试环境',
          '',
          mr ? `- 已合并 MR：[链接](${mr.url})` : '',
          `- 测试分支：\`${dep.targetBranch ?? 'test'}\``,
          note ? `- 备注：${note}` : '',
          '',
          `请 ${mention} **手动触发流水线 / 部署测试环境**，完成验证后点击下方按钮。`,
          '',
          '> 本 Loop 为**人工部署**模式，Ops Agent 不会自动执行部署。需要时可 @ops-agent 咨询配置。',
        ]
          .filter(Boolean)
          .join('\n'),
        mentions: deployAssignee ? failureMentions(deployAssignee) : undefined,
        actions: [
          {
            id: 'approve-test',
            label: '测试环境验证通过',
            action: 'approve_test',
          },
          {
            id: 'reject-test',
            label: '测试不通过，回退开发',
            action: 'reject_test',
          },
        ],
      },
    });
  }

  private isAwaitingTestApprovalStep(step?: string): boolean {
    return (
      step === 'awaiting_test_approval' ||
      step === 'awaiting_pipeline' ||
      step === 'awaiting_manual_test_deploy'
    );
  }

  private hasPassedTestApproval(step?: string): boolean {
    return (
      step === 'awaiting_master_mr_merge' ||
      step === 'awaiting_manual_prod_verify' ||
      step === 'awaiting_prod_deploy' ||
      step === 'awaiting_prod_approval'
    );
  }

  /** 测试验证通过：manual 创建 master MR；agent 启动 Ops 生产部署 */
  async onTestApproved(loopId: string, approvedBy: string): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) throw new NotFoundException('Loop not found');

    const dep = loop.context.deployment;
    const mode = dep?.executionMode ?? 'manual';
    const now = new Date().toISOString();

    if (this.hasPassedTestApproval(dep?.step)) {
      return;
    }
    if (!this.isAwaitingTestApprovalStep(dep?.step)) {
      throw new BadRequestException('当前不在等待测试环境审批状态');
    }

    await this.loopRepo.updateContext(loopId, {
      ...loop.context,
      deployment: {
        ...dep!,
        testApprovedAt: now,
        testApprovedBy: approvedBy,
      },
    });

    if (mode === 'agent') {
      await this.loopRepo.updateContext(loopId, {
        ...(await this.loopRepo.findById(loopId))!.context,
        deployment: {
          ...dep!,
          step: 'awaiting_prod_deploy',
          testApprovedAt: now,
          testApprovedBy: approvedBy,
          executionMode: mode,
        },
      });
      await this.chatService.publishAgentMessage({
        loopId,
        phase: 'deployment',
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: '测试环境验证已通过，正在启动 **Ops Agent** 执行生产环境正式上线…',
        },
      });
      await this.triggerOpsDeploy(loopId, approvedBy, 'production');
      return;
    }

    await this.createMasterMergeRequest(loopId, approvedBy);
  }

  /** manual：创建 test → master MR */
  private async createMasterMergeRequest(
    loopId: string,
    approvedBy: string,
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) return;

    const members = await this.memberRepo.listByLoop(loopId);
    const projectEntity = await this.projectRepo.findById(loop.project_id);
    const gitConfig = projectEntity?.git_config as Record<string, unknown> | undefined;
    if (!gitConfig?.remoteUrl) {
      throw new BadRequestException('项目未配置 gitConfig.remoteUrl');
    }

    const dep = loop.context.deployment!;
    const testB = dep.targetBranch ?? testBranch();
    const prodB = dep.productionBranch ?? productionBranch();

    let masterAssignee = pickNotifyMember(members, {
      preferUserId: approvedBy,
      skillsHint: process.env.DEPLOY_MERGE_SKILLS ?? '运维 合并 MR',
    });

    this.chatService.emitProcessing({
      loopId,
      active: true,
      label: '正在创建上线 MR…',
    });

    try {
      const mrCredentialRef = this.secretManager.resolveMrApiCredentialRef(
        gitConfig as { mrCredentialRef?: string },
      );
      const mrInput = {
        remoteUrl: String(gitConfig.remoteUrl),
        credentialRef: mrCredentialRef,
        headBranch: testB,
        baseBranch: prodB,
      };

      const comparison = await this.mergeRequestService.compareBranches(mrInput);
      if (comparison.aheadBy === 0 || comparison.identical) {
        await this.enterManualProdVerify(loopId, approvedBy, {
          skippedMasterMr: true,
          testBranch: testB,
          prodBranch: prodB,
        });
        return;
      }

      const mr = await this.mergeRequestService.createOrGetMergeRequest({
        ...mrInput,
        title: `loop ${loopId}: release to ${prodB}`,
        body: [
          `## Loop 上线合并请求`,
          '',
          `- Loop ID: \`${loopId}\``,
          `- 测试已通过，请将 \`${testB}\` 合并至 \`${prodB}\``,
          '',
          '由 Loop Orchestrator 在测试验证通过后自动创建。',
        ].join('\n'),
      });

      const now = new Date().toISOString();
      await this.loopRepo.updateContext(loopId, {
        ...loop.context,
        deployment: {
          ...dep,
          step: 'awaiting_master_mr_merge',
          masterMergeRequest: mr,
          masterMergeAssigneeUserId: masterAssignee?.userId,
          masterMergeAssigneeDisplayName: masterAssignee?.displayName,
        },
      });

      if (masterAssignee) {
        await this.loopRepo.updateBlocker(
          loopId,
          {
            kind: 'human_decision' as const,
            phase: 'deployment' as const,
            reason: `等待合并上线 MR：\`${testB}\` → \`${prodB}\``,
            question: mr.url,
            assigneeUserId: masterAssignee.userId,
            assigneeDisplayName: masterAssignee.displayName,
            requestedBy: 'orchestrator' as const,
            createdAt: now,
          },
          'blocked',
        );
      }

      const mention = this.formatMention(masterAssignee, members, '运维');
      await this.chatService.publishAgentMessage({
        loopId,
        phase: 'deployment',
        agentId: 'orchestrator',
        content: {
          type: 'artifact',
          body: [
            '## 请合并 MR 到生产分支',
            '',
            `- MR：[${mr.provider === 'gitlab' ? '!' : '#'}${mr.number}](${mr.url})`,
            `- 源分支：\`${testB}\``,
            `- 目标分支：\`${prodB}\``,
            '',
            `请 ${mention} 在 Git 平台 **Review 并合并** 该 MR。`,
            '',
            '合并后点击「上线 MR 已合并」，再完成生产环境验证。',
          ].join('\n'),
          mentions: masterAssignee ? failureMentions(masterAssignee) : undefined,
          actions: [
            {
              id: 'confirm-master-mr',
              label: '上线 MR 已合并',
              action: 'confirm_master_mr_merged',
            },
          ],
        },
      });
    } catch (err) {
      if (isNoCommitsBetweenBranchesError(err)) {
        await this.enterManualProdVerify(loopId, approvedBy, {
          skippedMasterMr: true,
          testBranch: testB,
          prodBranch: prodB,
        });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      await this.chatService.publishAgentMessage({
        loopId,
        phase: 'deployment',
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: [
            '## 上线 MR 创建失败',
            '',
            msg,
            '',
            '请检查 Git 分支与权限后，**再次点击「测试环境验证通过」** 重试。',
          ].join('\n'),
        },
      });
      throw err;
    } finally {
      this.chatService.emitProcessing({ loopId, active: false });
    }
  }

  /** manual：测试通过后进入生产验证（可跳过无差异的 test→master MR） */
  private async enterManualProdVerify(
    loopId: string,
    userId: string,
    options?: {
      note?: string;
      skippedMasterMr?: boolean;
      testBranch?: string;
      prodBranch?: string;
    },
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop?.context.deployment) return;

    const dep = loop.context.deployment;
    if (dep.step === 'awaiting_manual_prod_verify') return;

    const now = new Date().toISOString();
    const prodB = options?.prodBranch ?? dep.productionBranch ?? productionBranch();
    const testB = options?.testBranch ?? dep.targetBranch ?? testBranch();

    await this.loopRepo.updateContext(loopId, {
      ...loop.context,
      deployment: {
        ...dep,
        step: 'awaiting_manual_prod_verify',
        masterMrMergedAt: options?.skippedMasterMr ? now : dep.masterMrMergedAt,
        masterMrMergedBy: options?.skippedMasterMr ? userId : dep.masterMrMergedBy,
      },
    });
    await this.loopRepo.updateBlocker(loopId, null, 'active');

    const members = await this.memberRepo.listByLoop(loopId);
    const verifyAssignee = pickNotifyMember(members, {
      preferUserId: userId,
      skillsHint: process.env.DEPLOY_TEST_APPROVER_SKILLS ?? '测试 验收 QA',
    });

    const skipNote = options?.skippedMasterMr
      ? [
          '',
          `> \`${testB}\` 与 \`${prodB}\` **无新提交差异**，已跳过上线 MR，请直接验证生产环境。`,
        ]
      : [];

    await this.chatService.publishAgentMessage({
      loopId,
      phase: 'deployment',
      agentId: 'orchestrator',
      content: {
        type: 'artifact',
        body: [
          '## 请验证生产环境',
          '',
          dep.masterMergeRequest
            ? `- 上线 MR：[链接](${dep.masterMergeRequest.url})`
            : '',
          `- 生产分支：\`${prodB}\``,
          options?.note ? `- 备注：${options.note}` : '',
          ...skipNote,
          '',
          `请 ${this.formatMention(verifyAssignee, members, '测试')} **手动部署/触发流水线**（若尚未自动发布），验证生产环境无误后点击下方按钮完成本 Loop。`,
        ]
          .filter(Boolean)
          .join('\n'),
        mentions: verifyAssignee ? failureMentions(verifyAssignee) : undefined,
        actions: [
          {
            id: 'approve-deploy',
            label: '生产环境验证通过，完成 Loop',
            action: 'approve_deploy',
          },
        ],
      },
    });
  }

  async confirmMasterMrMerged(input: {
    loopId: string;
    userId: string;
    note?: string;
  }): Promise<void> {
    const loop = await this.loopRepo.findById(input.loopId);
    if (!loop) throw new NotFoundException('Loop not found');
    const dep = loop.context.deployment;
    if (dep?.step !== 'awaiting_master_mr_merge') {
      throw new BadRequestException('当前不在等待上线 MR 合并状态');
    }
    if (
      dep.masterMergeAssigneeUserId &&
      dep.masterMergeAssigneeUserId !== input.userId
    ) {
      throw new BadRequestException('仅被指派的合并负责人可确认上线 MR');
    }

    await this.enterManualProdVerify(input.loopId, input.userId, {
      note: input.note,
    });
  }

  /** Loop 完成（approve_deploy）：清除部署子步骤，避免 done 阶段仍显示待验证按钮 */
  async onProdVerificationComplete(
    loopId: string,
    approvedBy: string,
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop?.context.deployment) return;

    const now = new Date().toISOString();
    await this.loopRepo.updateContext(loopId, {
      ...loop.context,
      deployment: {
        ...loop.context.deployment,
        step: undefined,
        status: 'production',
        prodApprovedAt: now,
        prodApprovedBy: approvedBy,
      },
    });
    await this.loopRepo.updateBlocker(loopId, null, 'active');
  }

  /** @deprecated 使用 onTestApproved */
  async startProdDeploy(loopId: string, approvedBy: string): Promise<void> {
    return this.onTestApproved(loopId, approvedBy);
  }

  async markTestRejected(loopId: string, rejectedBy: string, note?: string): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop?.context.deployment) return;

    await this.loopRepo.updateContext(loopId, {
      ...loop.context,
      deployment: {
        ...loop.context.deployment,
        step: undefined,
        status: 'failed',
        testRejectedAt: new Date().toISOString(),
        testRejectedBy: rejectedBy,
      },
    });
    await this.loopRepo.updateBlocker(loopId, null, 'active');

    await this.chatService.publishAgentMessage({
      loopId,
      phase: loop.phase,
      agentId: 'orchestrator',
      content: {
        type: 'text',
        body: [
          '## 测试环境验证未通过',
          '',
          note ? `原因：${note}` : '流程将回退至 **development** 阶段，请修复后重新提交。',
        ].join('\n'),
      },
    });
  }

  async resumeOpsDeploy(
    loopId: string,
    userId: string,
    target: 'test' | 'production',
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (loop?.context.deployment?.executionMode === 'manual') {
      return;
    }
    await this.triggerOpsDeploy(loopId, userId, target);
  }

  getExecutionMode(loopId: string): Promise<DeploymentExecutionMode> {
    return this.loopRepo.findById(loopId).then((loop) => {
      if (!loop) return 'manual';
      const projectId = loop.project_id;
      return this.projectRepo.findById(projectId).then((p) =>
        resolveDeploymentExecution(p?.git_config as Record<string, unknown>),
      );
    });
  }

  private async triggerOpsDeploy(
    loopId: string,
    userId: string,
    target: 'test' | 'production',
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) return;
    if (loop.context.deployment?.executionMode === 'manual') return;

    const members = await this.memberRepo.listByLoop(loopId);
    if (target === 'test') {
      const testApprover = pickNotifyMember(members, {
        preferUserId: userId,
        skillsHint:
          process.env.DEPLOY_TEST_APPROVER_SKILLS ?? '测试 验收 QA',
      });
      if (testApprover && loop.context.deployment) {
        await this.loopRepo.updateContext(loopId, {
          ...loop.context,
          deployment: {
            ...loop.context.deployment,
            testApproverUserId: testApprover.userId,
            testApproverDisplayName: testApprover.displayName,
          },
        });
      }
    }

    await this.agentCoordinator.activate(loopId, 'ops', {
      reason: 'manual',
      userId,
    });
  }

  private async createTestBranchMrAndNotify(
    loopId: string,
    approvedBy?: string,
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) return;

    const members = await this.memberRepo.listByLoop(loopId);
    const projectEntity = await this.projectRepo.findById(loop.project_id);
    const gitConfig = projectEntity?.git_config as Record<string, unknown> | undefined;
    if (!gitConfig?.remoteUrl) {
      throw new Error('项目未配置 gitConfig.remoteUrl');
    }

    const executionMode = resolveDeploymentExecution(gitConfig);
    let mergeAssignee = pickNotifyMember(members, {
      preferUserId: approvedBy,
      skillsHint:
        process.env.DEPLOY_MERGE_SKILLS ?? '运维 合并 MR 代码评审',
    });
    if (!mergeAssignee && approvedBy) {
      mergeAssignee =
        members.find((m) => m.userId === approvedBy) ?? members[0] ?? null;
    }

    const targetBranch = testBranch();
    const prodBranch = productionBranch();
    const headBranch = loop.git_branch ?? `loop/${loopId}`;
    const devMode = loop.context.development?.mode;

    const mrCredentialRef = this.secretManager.resolveMrApiCredentialRef(
      gitConfig as { mrCredentialRef?: string },
    );

    const mr = await this.mergeRequestService.createOrGetMergeRequest({
      remoteUrl: String(gitConfig.remoteUrl),
      credentialRef: mrCredentialRef,
      headBranch,
      baseBranch: targetBranch,
      title: `loop ${loopId}: ${loop.title}`,
      body: [
        `## Loop 部署合并请求（测试分支）`,
        '',
        `- Loop ID: \`${loopId}\``,
        `- 标题: ${loop.title}`,
        `- 源分支: \`${headBranch}\``,
        `- 目标分支: \`${targetBranch}\``,
        `- 部署方式: ${executionMode === 'manual' ? '人工部署' : 'Ops Agent 自动部署'}`,
        devMode === 'external' ? '- 开发方式: 外部工具' : '- 开发方式: Loop Dev Agent',
        '',
        '由 Loop Orchestrator 自动创建。',
      ].join('\n'),
    });

    const now = new Date().toISOString();
    await this.loopRepo.updateContext(loopId, {
      ...loop.context,
      deployment: {
        ...loop.context.deployment,
        status: 'pending',
        executionMode,
        step: 'awaiting_mr_merge',
        targetBranch,
        productionBranch: prodBranch,
        mergeRequest: mr,
        mergeAssigneeUserId: mergeAssignee?.userId,
        mergeAssigneeDisplayName: mergeAssignee?.displayName,
      },
    });

    if (mergeAssignee) {
      await this.loopRepo.updateBlocker(
        loopId,
        {
          kind: 'human_decision' as const,
          phase: 'deployment' as const,
          reason: `等待合并 MR：\`${headBranch}\` → \`${targetBranch}\``,
          question: mr.url,
          assigneeUserId: mergeAssignee.userId,
          assigneeDisplayName: mergeAssignee.displayName,
          requestedBy: 'orchestrator' as const,
          createdAt: now,
        },
        'blocked',
      );
    }

    const mention = this.formatMention(mergeAssignee, members, '运维');
    const afterMergeNote =
      executionMode === 'manual'
        ? '合并完成后点击「MR 已合并」，系统将通知同事**手动部署测试环境**并验证。'
        : '合并完成后点击「MR 已合并」，将启动 Ops Agent 部署测试环境。';

    const body = [
      '## 请合并 MR 到测试分支',
      '',
      `- MR：[${mr.provider === 'gitlab' ? '!' : '#'}${mr.number}](${mr.url})`,
      `- 源分支：\`${headBranch}\``,
      `- 目标分支：\`${targetBranch}\``,
      `- 部署方式：**${executionMode === 'manual' ? '人工部署' : 'Ops Agent'}**`,
      '',
      `请 ${mention} 在 Git 平台 **Review 并合并** 该 MR。`,
      '',
      afterMergeNote,
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
  }

  private formatMention(
    assignee: LoopMember | null,
    members: LoopMember[],
    skillsHint: string,
  ): string {
    if (assignee) {
      return `@${assignee.userId}（${assignee.displayName}）`;
    }
    const fallback = suggestAssignee(members, skillsHint);
    return fallback
      ? `@${fallback.userId}（${fallback.displayName}）`
      : '**已加入成员中的相关同事**';
  }
}
