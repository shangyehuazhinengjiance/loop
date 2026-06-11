import type {
  Action,
  DeploymentInfo,
  OpsDeployTarget,
} from '@loop/shared';

export interface OpsDeployCompletion {
  deployment: DeploymentInfo;
  actions: Action[];
  artifactTitle: string;
}

/** Ops Agent 完成一次部署后：更新 context 并生成群聊审批按钮 */
export function buildOpsDeployCompletion(input: {
  deployTarget: OpsDeployTarget;
  deployment: DeploymentInfo | undefined;
  bodyText: string;
  url?: string;
}): OpsDeployCompletion {
  const now = new Date().toISOString();
  const base = { ...input.deployment, status: 'pending' as const };

  if (input.deployTarget === 'test') {
    return {
      deployment: {
        ...base,
        step: 'awaiting_test_approval',
        stagingUrl: input.url ?? input.deployment?.stagingUrl,
        status: 'staging',
        testDeployedAt: now,
      },
      artifactTitle: '## 测试环境部署完成',
      actions: [
        { id: 'approve-test', label: '测试通过，进入上线', action: 'approve_test' },
        { id: 'reject-test', label: '测试不通过，回退开发', action: 'reject_test' },
      ],
    };
  }

  return {
    deployment: {
      ...base,
      step: 'awaiting_prod_approval',
      productionUrl: input.url ?? input.deployment?.productionUrl,
      status: 'production',
      prodDeployedAt: now,
    },
    artifactTitle: '## 生产环境部署完成',
    actions: [
      { id: 'approve-deploy', label: '确认正式上线完成', action: 'approve_deploy' },
    ],
  };
}

export function extractDeployUrl(text: string): string | undefined {
  return text.match(/https?:\/\/[^\s)]+/)?.[0];
}
