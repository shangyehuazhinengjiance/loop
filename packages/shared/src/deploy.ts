import type { DeploymentStep, OpsDeployTarget } from './types.js';

/** 根据 deployment 子步骤解析 Ops Agent 当前应执行的部署目标 */
export function resolveOpsDeployTarget(
  step?: DeploymentStep,
): OpsDeployTarget | null {
  if (step === 'awaiting_test_deploy') return 'test';
  if (step === 'awaiting_prod_deploy') return 'production';
  return null;
}

/** 是否处于测试环境人工审批等待态 */
export function isAwaitingTestApproval(step?: DeploymentStep): boolean {
  return step === 'awaiting_test_approval' || step === 'awaiting_pipeline';
}

/** 是否处于生产发布最终确认等待态 */
export function isAwaitingProdApproval(step?: DeploymentStep): boolean {
  return step === 'awaiting_prod_approval';
}
