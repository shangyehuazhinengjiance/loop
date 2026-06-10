import type { ApprovalActionType } from '@loop/shared';
import { Injectable, BadRequestException } from '@nestjs/common';
import { ApprovalRepository } from '../db/repositories/approval.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { PhaseService } from '../phase/phase.service.js';

const ACTION_REQUIRED_PHASE: Record<
  Exclude<ApprovalActionType, 'rollback'>,
  string
> = {
  approve_prd: 'requirement',
  approve_dev: 'development',
  approve_deploy: 'deployment',
};

@Injectable()
export class ApprovalService {
  constructor(
    private readonly approvalRepo: ApprovalRepository,
    private readonly loopRepo: LoopRepository,
    private readonly phaseService: PhaseService,
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
