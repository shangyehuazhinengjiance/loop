import {
  collectReachedPhases,
  getAllowedPhaseSwitchTargets,
  PHASE_LABEL_ZH,
  PhaseStateMachine,
  PhaseTransitionError,
  type ApprovalActionType,
  type LoopContext,
  type Phase,
  type TransitionTrigger,
} from '@loop/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { LoopRow } from '../db/repositories/loop.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ChatService } from '../chat/chat.service.js';
import { PhaseTransitionRepository } from '../db/repositories/phase-transition.repository.js';
import { SnapshotRepository } from '../db/repositories/snapshot.repository.js';
import { AgentCoordinator } from '../agent/agent-coordinator.js';
import { GitService } from '../git/git.service.js';
import { ArtifactService } from '../artifact/artifact.service.js';
import { AuditService } from '../audit/audit.service.js';
import { DeploymentService } from '../deployment/deployment.service.js';
import { RequirementsSummaryService } from '../requirements/requirements-summary.service.js';
import { LoopDotLoopService } from '../loop-context/loop-dot-loop.service.js';
import { ApprovalRepository } from '../db/repositories/approval.repository.js';

export interface PhaseChangeEvent {
  loopId: string;
  fromPhase: Phase;
  toPhase: Phase;
  trigger: TransitionTrigger | ApprovalActionType;
  activateAgent?: 'pm' | 'dev' | 'ops';
}

@Injectable()
export class PhaseService {
  private readonly stateMachine = new PhaseStateMachine();

  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly snapshotRepo: SnapshotRepository,
    private readonly transitionRepo: PhaseTransitionRepository,
    private readonly chatService: ChatService,
    private readonly agentCoordinator: AgentCoordinator,
    private readonly gitService: GitService,
    private readonly artifactService: ArtifactService,
    private readonly auditService: AuditService,
    private readonly deploymentService: DeploymentService,
    private readonly requirementsSummary: RequirementsSummaryService,
    private readonly loopDotLoop: LoopDotLoopService,
    private readonly approvalRepo: ApprovalRepository,
  ) {}

  getStateMachine(): PhaseStateMachine {
    return this.stateMachine;
  }

  async getPhaseSwitchOptions(loopId: string): Promise<{
    currentPhase: Phase;
    currentLabel: string;
    reachedPhases: { phase: Phase; label: string }[];
    switchTargets: { phase: Phase; label: string }[];
  }> {
    const loop = await this.requireLoop(loopId);
    const transitions = await this.transitionRepo.listByLoop(loopId);
    const reachedPhases = collectReachedPhases(
      loop.phase,
      transitions.map((t) => ({
        fromPhase: t.from_phase,
        toPhase: t.to_phase,
      })),
    );
    const switchTargets = getAllowedPhaseSwitchTargets(
      loop.phase,
      reachedPhases,
      this.stateMachine.getRollbackTargets(loop.phase),
    );
    return {
      currentPhase: loop.phase,
      currentLabel: PHASE_LABEL_ZH[loop.phase],
      reachedPhases: reachedPhases.map((phase) => ({
        phase,
        label: PHASE_LABEL_ZH[phase],
      })),
      switchTargets: switchTargets.map((phase) => ({
        phase,
        label: PHASE_LABEL_ZH[phase],
      })),
    };
  }

  async start(loopId: string): Promise<PhaseChangeEvent> {
    const loop = await this.requireLoop(loopId);
    return this.applyTransition(loop, 'start');
  }

  async approve(
    loopId: string,
    action: ApprovalActionType,
    approvedBy: string,
    note?: string,
  ): Promise<PhaseChangeEvent> {
    const loop = await this.requireLoop(loopId);
    const trigger = this.stateMachine.approvalToTrigger(action);
    if (!trigger || trigger === 'rollback') {
      throw new PhaseTransitionError(
        `Action ${action} is not a forward approval`,
        loop.phase,
        action,
      );
    }

    const snapshot = await this.createSnapshotForApproval(loop, action, approvedBy);
    const event = await this.applyTransition(loop, trigger, snapshot?.id);

    await this.chatService.publishAgentMessage({
      loopId,
      phase: event.toPhase,
      agentId: 'orchestrator',
      content: {
        type: 'phase_transition',
        body: `阶段流转：${event.fromPhase} → ${event.toPhase}（${action}，by ${approvedBy}${note ? `：${note}` : ''}）`,
      },
    });

    await this.auditService.log({
      loopId,
      action: `approval:${action}`,
      detail: { approvedBy, note, fromPhase: event.fromPhase, toPhase: event.toPhase },
      phase: event.toPhase,
    });

    if (action === 'approve_dev' && event.toPhase === 'deployment') {
      await this.deploymentService.submitToTestBranch(loopId, approvedBy);
    }

    if (action === 'approve_deploy' && event.toPhase === 'done') {
      await this.deploymentService.onProdVerificationComplete(loopId, approvedBy);
      if (this.loopDotLoop.isEnabled()) {
        void this.loopDotLoop.finalizeOnLoopComplete(loopId, approvedBy);
      } else {
        void this.requirementsSummary.finalizeLoop(loopId, approvedBy);
      }
    }

    return event;
  }

  /** development 阶段 PRD 增量修订确认：打快照但不改变 phase */
  async confirmPrdRevision(
    loopId: string,
    approvedBy: string,
    note?: string,
  ): Promise<void> {
    const loop = await this.requireLoop(loopId);
    if (loop.phase !== 'development') {
      throw new BadRequestException(
        'confirm_prd_revision requires development phase',
      );
    }

    const snapshot = await this.createSnapshotForApproval(
      loop,
      'confirm_prd_revision',
      approvedBy,
    );

    await this.chatService.publishAgentMessage({
      loopId,
      phase: loop.phase,
      agentId: 'orchestrator',
      content: {
        type: 'text',
        body: `PRD 修订已确认（by ${approvedBy}${note ? `：${note}` : ''}），将恢复开发流程。`,
      },
    });

    await this.auditService.log({
      loopId,
      action: 'approval:confirm_prd_revision',
      detail: { approvedBy, note, snapshotId: snapshot?.id },
      phase: loop.phase,
    });
  }

  async rollback(
    loopId: string,
    targetPhase: Phase,
    reason: string,
    userId: string,
    snapshotId?: string,
  ): Promise<PhaseChangeEvent> {
    const loop = await this.requireLoop(loopId);

    const switchOptions = await this.getPhaseSwitchOptions(loopId);
    if (switchOptions.currentPhase === targetPhase) {
      throw new BadRequestException('已在目标阶段，无需切换');
    }
    if (!switchOptions.switchTargets.some((t) => t.phase === targetPhase)) {
      throw new BadRequestException(
        '无法切换到该阶段：仅可回退到本 Loop 曾到达过的更早阶段',
      );
    }

    if (!this.stateMachine.canRollback(loop.phase, targetPhase)) {
      throw new PhaseTransitionError(
        `Cannot rollback from ${loop.phase} to ${targetPhase}`,
        loop.phase,
        'rollback',
        targetPhase,
      );
    }

    const snapshot =
      snapshotId
        ? await this.snapshotRepo.findById(snapshotId)
        : await this.snapshotRepo.findLatestByPhase(loopId, targetPhase);

    if (snapshot) {
      const restored: LoopContext = {
        prd: snapshot.prd ?? undefined,
        tasks: snapshot.tasks ?? undefined,
        gitRef: snapshot.git_ref ?? undefined,
        devSessionId: undefined,
        opsSessionId: undefined,
      };
      await this.loopRepo.updateContext(loopId, restored);

      if (snapshot.git_ref) {
        try {
          await this.gitService.checkoutRef(loopId, snapshot.git_ref);
        } catch (err) {
          await this.auditService.log({
            loopId,
            action: 'rollback:git_checkout_failed',
            detail: { error: String(err), gitRef: snapshot.git_ref },
            notifyChat: true,
            phase: targetPhase,
          });
        }
      }
    }

    const result = this.stateMachine.rollback(loop.phase, targetPhase, reason);
    await this.approvalRepo.deleteApprovalsFromPhaseOnwards(loopId, targetPhase);
    await this.loopRepo.updatePhase(loopId, result.toPhase);
    await this.transitionRepo.create({
      loopId,
      fromPhase: result.fromPhase,
      toPhase: result.toPhase,
      trigger: 'rollback',
      snapshotId: snapshot?.id,
    });

    await this.chatService.publishAgentMessage({
      loopId,
      phase: targetPhase,
      agentId: 'orchestrator',
      content: {
        type: 'rollback',
        body: `已回退到 ${targetPhase} 阶段，原因：${reason}`,
      },
    });

    await this.auditService.log({
      loopId,
      action: 'rollback',
      detail: { from: result.fromPhase, to: targetPhase, reason, userId },
      phase: targetPhase,
    });

    const event: PhaseChangeEvent = {
      loopId,
      fromPhase: result.fromPhase,
      toPhase: result.toPhase,
      trigger: 'rollback',
      activateAgent: result.activateAgent,
    };

    if (result.activateAgent) {
      await this.agentCoordinator.activate(loopId, result.activateAgent, {
        reason: 'rollback',
        userId,
      });
    }

    return event;
  }

  private async applyTransition(
    loop: LoopRow,
    trigger: TransitionTrigger,
    snapshotId?: string,
  ): Promise<PhaseChangeEvent> {
    const result = this.stateMachine.transition(loop.phase, trigger);
    const status = result.toPhase === 'done' ? 'done' : loop.status;

    await this.loopRepo.updatePhase(loop.id, result.toPhase, status);
    await this.transitionRepo.create({
      loopId: loop.id,
      fromPhase: result.fromPhase,
      toPhase: result.toPhase,
      trigger,
      snapshotId,
    });

    const event: PhaseChangeEvent = {
      loopId: loop.id,
      fromPhase: result.fromPhase,
      toPhase: result.toPhase,
      trigger,
      activateAgent: result.activateAgent,
    };

    if (result.activateAgent) {
      await this.agentCoordinator.activate(loop.id, result.activateAgent, {
        reason: 'phase_entry',
      });
    }

    return event;
  }

  private async createSnapshotForApproval(
    loop: LoopRow,
    action: ApprovalActionType,
    createdBy: string,
  ) {
    const labels: Partial<Record<ApprovalActionType, string>> = {
      approve_prd: 'PRD 确认',
      confirm_prd_revision: 'PRD 修订确认',
      approve_dev: '开发验收',
      approve_deploy: '流水线完成',
    };

    const label = labels[action];
    if (!label) return null;

    let gitRef = loop.context.gitRef ?? '';
    try {
      gitRef = await this.gitService.createSnapshotTag(loop.id, loop.phase, label);
      await this.gitService.pushLoopBranch(loop.id);
    } catch {
      // 无 git 远程时跳过
    }

    if (loop.context.prd) {
      await this.artifactService.savePrd(
        loop.id,
        loop.phase,
        loop.context.prd,
        createdBy,
      );
    }

    if (action === 'approve_dev' && gitRef) {
      await this.artifactService.saveCodeDiff(
        loop.id,
        loop.phase,
        gitRef,
        undefined,
        createdBy,
      );
    }

    const watermark = await this.chatService.latestMessageId(loop.id);
    return this.snapshotRepo.create({
      loopId: loop.id,
      phase: loop.phase,
      label,
      createdBy,
      context: { ...loop.context, gitRef },
      gitRef,
      gitBranch: loop.git_branch ?? undefined,
      messageWatermark: watermark ?? undefined,
    });
  }

  private async requireLoop(loopId: string): Promise<LoopRow> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }
    return loop;
  }
}
