import { Injectable, NotFoundException } from '@nestjs/common';
import { BlockerService } from '../blocker/blocker.service.js';
import { ChatService } from '../chat/chat.service.js';
import { DeploymentService } from '../deployment/deployment.service.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { AgentCoordinator } from '../agent/agent-coordinator.js';

export interface LoopRecoveryResult {
  ok: true;
  actions: string[];
  hints: string[];
}

@Injectable()
export class LoopRecoveryService {
  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly blockerService: BlockerService,
    private readonly deploymentService: DeploymentService,
    private readonly chatService: ChatService,
    private readonly agentCoordinator: AgentCoordinator,
  ) {}

  /** 一键恢复：解除阻塞、重试卡住的部署步骤 */
  async recover(loopId: string, userId: string): Promise<LoopRecoveryResult> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) throw new NotFoundException('Loop not found');

    const actions: string[] = [];
    const hints: string[] = [];

    this.chatService.emitProcessing({ loopId, active: false });

    if (loop.status === 'blocked' && loop.blocker) {
      await this.blockerService.resolve({
        loopId,
        userId,
        note: '一键恢复',
      });
      actions.push(
        `已解除阻塞（原请求方：${loop.blocker.requestedBy}），并已尝试重新激活对应 Agent`,
      );
    }

    const fresh = (await this.loopRepo.findById(loopId))!;
    const dep = fresh.context.deployment;
    const step = dep?.step;

    const manual = dep?.executionMode === 'manual';

    if (fresh.phase === 'deployment') {
      if (step === 'awaiting_mr_merge') {
        hints.push(
          '当前等待 MR 合并：请在 Git 平台合并后，点击「部署操作」中的「MR 已合并」，或调用 POST /api/loops/:id/approve（action: confirm_mr_merged）。',
        );
      } else if (step === 'awaiting_manual_test_deploy') {
        hints.push(
          '当前为人工部署模式：请手动部署测试环境，验证后点击「测试环境验证通过」，或调用 approve（action: approve_test）。',
        );
      } else if (step === 'awaiting_master_mr_merge') {
        hints.push(
          '当前等待上线 MR 合并：请在 Git 平台合并后，点击「上线 MR 已合并」，或调用 approve（action: confirm_master_mr_merged）。',
        );
      } else if (
        step === 'awaiting_test_approval' ||
        step === 'awaiting_pipeline'
      ) {
        hints.push(
          '当前等待测试环境审批：请点击「测试通过」或「测试不通过」，或调用 approve（action: approve_test / reject_test）。',
        );
      } else if (step === 'awaiting_manual_prod_verify') {
        hints.push(
          '当前等待生产环境验证：验证无误后点击「生产环境验证通过，完成 Loop」，或调用 approve（action: approve_deploy）。',
        );
      } else if (step === 'awaiting_prod_approval') {
        hints.push(
          '当前等待确认正式上线：请点击「确认正式上线完成」，或调用 approve（action: approve_deploy）。',
        );
      } else if (step === 'awaiting_test_deploy' && !manual) {
        await this.deploymentService.resumeOpsDeploy(loopId, userId, 'test');
        actions.push('已重新启动 Ops Agent（测试环境部署）');
      } else if (step === 'awaiting_prod_deploy' && !manual) {
        await this.deploymentService.resumeOpsDeploy(loopId, userId, 'production');
        actions.push('已重新启动 Ops Agent（生产环境部署）');
      } else if (!step && !dep?.mergeRequest) {
        await this.deploymentService.submitToTestBranch(loopId, userId);
        actions.push('已重新尝试创建 MR 并进入部署流程');
      }
    } else if (fresh.phase === 'development' && fresh.context.development?.mode === 'agent') {
      await this.agentCoordinator.activate(loopId, 'dev', {
        reason: 'manual',
        userId,
      });
      actions.push('已重新激活 Dev Agent');
    } else if (fresh.phase === 'requirement' && !fresh.context.prd) {
      await this.agentCoordinator.activate(loopId, 'pm', {
        reason: 'manual',
        userId,
      });
      actions.push('已重新激活 PM Agent');
    }

    if (actions.length === 0 && hints.length === 0) {
      hints.push(
        '未发现可自动恢复的步骤。可尝试 @ 对应 Agent，或使用顶部「回退」后重新推进。',
      );
    }

    if (actions.length > 0) {
      await this.chatService.publishAgentMessage({
        loopId,
        phase: fresh.phase,
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: ['## 流程已恢复', '', ...actions.map((a) => `- ${a}`)].join('\n'),
        },
      });
    }

    return { ok: true, actions, hints };
  }
}
