import type { Phase } from './types.js';

export const PHASE_ORDER: Phase[] = [
  'created',
  'requirement',
  'development',
  'deployment',
  'done',
];

export const PHASE_LABEL_ZH: Record<Phase, string> = {
  created: '已创建',
  requirement: '需求',
  development: '开发',
  deployment: '部署',
  done: '完成',
};

export function phaseIndex(phase: Phase): number {
  return PHASE_ORDER.indexOf(phase);
}

/** 根据流转历史与当前阶段，汇总本 Loop 曾到达过的阶段 */
export function collectReachedPhases(
  currentPhase: Phase,
  transitions: { fromPhase?: Phase | null; toPhase: Phase }[],
): Phase[] {
  const reached = new Set<Phase>(['created', currentPhase]);
  for (const t of transitions) {
    reached.add(t.toPhase);
    if (t.fromPhase) reached.add(t.fromPhase);
  }
  return PHASE_ORDER.filter((p) => reached.has(p));
}

/**
 * 可切换目标 = 状态机允许的回退目标 ∩ 历史已到达阶段。
 * 不允许跳到未经历的阶段，也不允许向前（如 requirement → deployment）。
 */
export function getAllowedPhaseSwitchTargets(
  currentPhase: Phase,
  reachedPhases: Iterable<Phase>,
  rollbackTargets: Phase[],
): Phase[] {
  const reached = new Set(reachedPhases);
  return rollbackTargets.filter((p) => reached.has(p));
}
