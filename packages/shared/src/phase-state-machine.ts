import type { ApprovalActionType, Phase, TransitionTrigger } from './types.js';

export class PhaseTransitionError extends Error {
  constructor(
    message: string,
    public readonly from: Phase,
    public readonly trigger: TransitionTrigger | ApprovalActionType,
    public readonly targetPhase?: Phase,
  ) {
    super(message);
    this.name = 'PhaseTransitionError';
  }
}

/** 正向流转：trigger → 目标阶段 */
const FORWARD_TRANSITIONS: Record<TransitionTrigger, Partial<Record<Phase, Phase>>> = {
  start: { created: 'requirement' },
  approve_prd: { requirement: 'development' },
  approve_dev: { development: 'deployment' },
  approve_deploy: { deployment: 'done' },
  rollback: {},
};

/** 回退：当前阶段 → 允许回退到的目标阶段 */
const ROLLBACK_TARGETS: Partial<Record<Phase, Phase[]>> = {
  development: ['requirement'],
  deployment: ['development', 'requirement'],
  done: ['deployment', 'development', 'requirement'],
};

/** 进入某阶段时自动激活的 Agent（development 由用户选择 agent/external 后再激活 dev） */
export const PHASE_AGENT: Partial<Record<Phase, 'pm' | 'dev' | 'ops'>> = {
  requirement: 'pm',
};

export interface TransitionResult {
  fromPhase: Phase;
  toPhase: Phase;
  trigger: TransitionTrigger | ApprovalActionType;
  activateAgent?: 'pm' | 'dev' | 'ops';
}

export class PhaseStateMachine {
  canTransition(from: Phase, trigger: TransitionTrigger): boolean {
    return this.resolveForward(from, trigger) !== null;
  }

  canRollback(from: Phase, targetPhase: Phase): boolean {
    return this.getRollbackTargets(from).includes(targetPhase);
  }

  /** 状态机允许的回退目标（仅更早阶段，不含向前跳转） */
  getRollbackTargets(from: Phase): Phase[] {
    return ROLLBACK_TARGETS[from] ?? [];
  }

  transition(from: Phase, trigger: TransitionTrigger): TransitionResult {
    if (trigger === 'rollback') {
      throw new PhaseTransitionError(
        'Use rollback() for rollback transitions',
        from,
        trigger,
      );
    }

    const toPhase = this.resolveForward(from, trigger);
    if (!toPhase) {
      throw new PhaseTransitionError(
        `Invalid transition: ${from} + ${trigger}`,
        from,
        trigger,
      );
    }

    return {
      fromPhase: from,
      toPhase,
      trigger,
      activateAgent: PHASE_AGENT[toPhase],
    };
  }

  rollback(from: Phase, targetPhase: Phase, reason?: string): TransitionResult {
    if (!this.canRollback(from, targetPhase)) {
      throw new PhaseTransitionError(
        `Cannot rollback from ${from} to ${targetPhase}${reason ? `: ${reason}` : ''}`,
        from,
        'rollback',
        targetPhase,
      );
    }

    return {
      fromPhase: from,
      toPhase: targetPhase,
      trigger: 'rollback',
      activateAgent: PHASE_AGENT[targetPhase],
    };
  }

  /** 审批 action 映射到状态机 trigger */
  approvalToTrigger(action: ApprovalActionType): TransitionTrigger | null {
    switch (action) {
      case 'approve_prd':
        return 'approve_prd';
      case 'approve_dev':
        return 'approve_dev';
      case 'approve_deploy':
        return 'approve_deploy';
      case 'rollback':
        return 'rollback';
      default:
        return null;
    }
  }

  private resolveForward(from: Phase, trigger: TransitionTrigger): Phase | null {
    const table = FORWARD_TRANSITIONS[trigger];
    return table?.[from] ?? null;
  }
}
