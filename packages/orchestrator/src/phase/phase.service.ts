import {
  PhaseStateMachine,
  PhaseTransitionError,
  type ApprovalActionType,
  type LoopContext,
  type Phase,
  type TransitionTrigger,
} from '@loop/shared';
import { Injectable } from '@nestjs/common';
import type { LoopRow } from '../db/repositories/loop.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ChatService } from '../chat/chat.service.js';
import { PhaseTransitionRepository } from '../db/repositories/phase-transition.repository.js';
import { SnapshotRepository } from '../db/repositories/snapshot.repository.js';
import { AgentCoordinator } from '../agent/agent-coordinator.js';
import { GitService } from '../git/git.service.js';
import { ArtifactService } from '../artifact/artifact.service.js';
import { AuditService } from '../audit/audit.service.js';

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
  ) {}

  getStateMachine(): PhaseStateMachine {
    return this.stateMachine;
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

    return event;
  }

  async rollback(
    loopId: string,
    targetPhase: Phase,
    reason: string,
    userId: string,
    snapshotId?: string,
  ): Promise<PhaseChangeEvent> {
    const loop = await this.requireLoop(loopId);

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
      approve_dev: '开发验收',
      approve_deploy: '发布确认',
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
