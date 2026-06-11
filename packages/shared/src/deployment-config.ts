import type { DeploymentExecutionMode } from './types.js';

/** 解析项目部署执行方式（默认 manual：人合并 MR、人部署；agent 才自动跑 Ops Agent） */
export function resolveDeploymentExecution(
  gitConfig?: Record<string, unknown> | null,
): DeploymentExecutionMode {
  const fromProject = gitConfig?.deploymentExecution;
  if (fromProject === 'agent' || fromProject === 'manual') {
    return fromProject;
  }
  const fromEnv = process.env.DEPLOY_EXECUTION_MODE?.trim();
  if (fromEnv === 'agent' || fromEnv === 'manual') return fromEnv;
  return 'manual';
}

export function productionBranch(): string {
  return process.env.DEPLOY_PRODUCTION_BRANCH?.trim() || 'master';
}

export function testBranch(): string {
  return process.env.DEPLOY_TARGET_BRANCH?.trim() || 'test';
}
