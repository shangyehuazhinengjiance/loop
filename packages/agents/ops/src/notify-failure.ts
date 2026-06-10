import type { LoopMember } from '@loop/shared';
import {
  buildAgentFailureMessage,
  failureMentions,
  pickNotifyMember,
} from '@loop/shared';
import type { OrchestratorApi } from './orchestrator-api.js';

const OPS_DEBUG_HINTS = [
  'Pod 内执行：`echo $OPS_AGENT_RUNTIME $OPS_MODEL_BASE_URL $OPS_MODEL_NAME`（非 Claude 应为 client-sdk）',
  '查看日志：`kubectl logs deploy/orchestrator | grep -E "ops-agent|Ops Agent"`',
  '直连测试：对 `$OPS_MODEL_BASE_URL/v1/chat/completions` 发一条 chat 请求',
  '开启 `OPS_AGENT_DEBUG=true` 可在失败消息中看到模型原始响应摘要',
];

export async function notifyOpsFailure(
  api: OrchestratorApi,
  loopId: string,
  phase: string,
  reason: string,
  members: LoopMember[],
  opts?: {
    preferUserId?: string;
    debug?: string;
    hints?: string[];
  },
): Promise<void> {
  const member = pickNotifyMember(members, {
    preferUserId: opts?.preferUserId,
    skillsHint: '运维 K8s 部署',
  });
  const body = buildAgentFailureMessage({
    agentLabel: 'Ops Agent',
    reason,
    member,
    debug:
      process.env.OPS_AGENT_DEBUG === 'true' ? opts?.debug : undefined,
    hints: opts?.hints ?? OPS_DEBUG_HINTS,
  });
  await api.postAgentMessage(
    loopId,
    {
      type: 'text',
      body,
      mentions: failureMentions(member),
    },
    phase,
  );
}
