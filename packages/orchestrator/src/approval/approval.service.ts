import { isAwaitingProdApproval, type ApprovalActionType } from '@loop/shared';
import { Injectable, BadRequestException } from '@nestjs/common';
import { ApprovalRepository } from '../db/repositories/approval.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { DevelopmentService } from '../development/development.service.js';
import { DeploymentService } from '../deployment/deployment.service.js';
import { PhaseService } from '../phase/phase.service.js';

const ACTION_REQUIRED_PHASE: Record<
  Exclude<ApprovalActionType, 'rollback'>,
  string
> = {
  approve_prd: 'requirement',
  approve_dev: 'development',
  confirm_mr_merged: 'deployment',
  confirm_master_mr_merged: 'deployment',
  approve_test: 'deployment',
  reject_test: 'deployment',
  approve_deploy: 'deployment',
};

@Injectable()
export class ApprovalService {
  constructor(
    private readonly approvalRepo: ApprovalRepository,
    private readonly loopRepo: LoopRepository,
    private readonly phaseService: PhaseService,
    private readonly developmentService: DevelopmentService,
    private readonly deploymentService: DeploymentService,
  ) {}

  async approve(input: {
    loopId: string;
    action: ApprovalActionType;
    approvedBy: string;
    note?: string;
  }) {
    if (input.action === 'rollback') {
      throw new BadRequestException('Use POST /api/loops/:id/rollback for rollback');
    }

    const loop = await this.loopRepo.findById(input.loopId);
    if (!loop) throw new BadRequestException('Loop not found');

    if (
      input.action === 'approve_deploy' &&
      loop.phase === 'done' &&
      isAwaitingProdApproval(loop.context.deployment?.step)
    ) {
      await this.deploymentService.onProdVerificationComplete(
        input.loopId,
        input.approvedBy,
      );
      return {
        duplicate: true,
        action: input.action,
        phase: loop.phase,
        alreadyCompleted: true,
      };
    }

    const requiredPhase = ACTION_REQUIRED_PHASE[input.action];
    if (loop.phase !== requiredPhase) {
      throw new BadRequestException(
        `Action ${input.action} requires phase ${requiredPhase}, current: ${loop.phase}`,
      );
    }

    const exists = await this.approvalRepo.hasApprovalInPhase(
      input.loopId,
      input.action,
      loop.phase,
    );
    if (exists) {
      return { duplicate: true, action: input.action, phase: loop.phase };
    }

    if (input.action === 'confirm_mr_merged') {
      await this.approvalRepo.create({
        loopId: input.loopId,
        action: input.action,
        approvedBy: input.approvedBy,
        phase: loop.phase,
        note: input.note,
      });
      await this.deploymentService.confirmMrMerged({
        loopId: input.loopId,
        userId: input.approvedBy,
        note: input.note,
      });
      return { duplicate: false, action: input.action, phase: loop.phase };
    }

    if (input.action === 'confirm_master_mr_merged') {
      const dep = loop.context.deployment;
      if (dep?.step !== 'awaiting_master_mr_merge') {
        throw new BadRequestException('当前不在等待上线 MR 合并状态');
      }
      await this.approvalRepo.create({
        loopId: input.loopId,
        action: input.action,
        approvedBy: input.approvedBy,
        phase: loop.phase,
        note: input.note,
      });
      await this.deploymentService.confirmMasterMrMerged({
        loopId: input.loopId,
        userId: input.approvedBy,
        note: input.note,
      });
      return { duplicate: false, action: input.action, phase: loop.phase };
    }

    if (input.action === 'approve_test') {
      const dep = loop.context.deployment;
      if (
        dep?.step !== 'awaiting_test_approval' &&
        dep?.step !== 'awaiting_pipeline' &&
        dep?.step !== 'awaiting_manual_test_deploy'
      ) {
        throw new BadRequestException('当前不在等待测试环境审批状态');
      }
      const exists = await this.approvalRepo.hasApprovalInPhase(
        input.loopId,
        input.action,
        loop.phase,
      );
      if (exists) {
        return { duplicate: true, action: input.action, phase: loop.phase };
      }
      await this.approvalRepo.create({
        loopId: input.loopId,
        action: input.action,
        approvedBy: input.approvedBy,
        phase: loop.phase,
        note: input.note,
      });
      await this.deploymentService.onTestApproved(
        input.loopId,
        input.approvedBy,
      );
      return { duplicate: false, action: input.action, phase: loop.phase };
    }

    if (input.action === 'reject_test') {
      const dep = loop.context.deployment;
      if (
        dep?.step !== 'awaiting_test_approval' &&
        dep?.step !== 'awaiting_pipeline' &&
        dep?.step !== 'awaiting_manual_test_deploy'
      ) {
        throw new BadRequestException('当前不在等待测试环境审批状态');
      }
      await this.approvalRepo.create({
        loopId: input.loopId,
        action: input.action,
        approvedBy: input.approvedBy,
        phase: loop.phase,
        note: input.note,
      });
      await this.deploymentService.markTestRejected(
        input.loopId,
        input.approvedBy,
        input.note,
      );
      await this.phaseService.rollback(
        input.loopId,
        'development',
        input.note ?? '测试环境验证未通过',
        input.approvedBy,
      );
      const prdBy = await this.developmentService.getPrdApprovedBy(input.loopId);
      if (prdBy) {
        await this.developmentService.onEnterDevelopment(input.loopId, prdBy, {
          reprompt: true,
        });
      }
      return { duplicate: false, action: input.action, phase: loop.phase };
    }

    if (input.action === 'approve_deploy') {
      const dep = loop.context.deployment;
      if (
        dep?.step &&
        dep.step !== 'awaiting_prod_approval' &&
        dep.step !== 'awaiting_pipeline' &&
        dep.step !== 'awaiting_manual_prod_verify'
      ) {
        throw new BadRequestException(
          '请先完成测试验证、上线 MR 合并与生产验证，再确认完成',
        );
      }
    }

    await this.approvalRepo.create({
      loopId: input.loopId,
      action: input.action,
      approvedBy: input.approvedBy,
      phase: loop.phase,
      note: input.note,
    });

    const event = await this.phaseService.approve(
      input.loopId,
      input.action,
      input.approvedBy,
      input.note,
    );

    if (input.action === 'approve_prd' && event.toPhase === 'development') {
      await this.developmentService.onEnterDevelopment(
        input.loopId,
        input.approvedBy,
      );
    }

    return { duplicate: false, event };
  }

  async list(loopId: string) {
    const rows = await this.approvalRepo.listByLoop(loopId);
    return rows.map((r) => ({
      type: r.action,
      loopId: r.loop_id,
      phase: r.phase,
      approvedBy: r.approved_by,
      approvedAt: r.created_at.toISOString(),
      note: r.note ?? undefined,
    }));
  }
}
