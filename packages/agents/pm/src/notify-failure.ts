import type { LoopMember } from '@loop/shared';
import {
  buildAgentFailureMessage,
  failureMentions,
  pickNotifyMember,
} from '@loop/shared';
import type { OrchestratorApi } from './orchestrator-api.js';

const PM_DEBUG_HINTS = [
  'Pod 内执行：`echo $PM_MODEL_BASE_URL $PM_MODEL_NAME $PM_AGENT_RUNTIME`（非 Claude 应为 client-sdk）',
  '查看日志：`kubectl logs deploy/orchestrator | grep -E "pm-agent|PM Agent"`',
  '直连测试：对 `$PM_MODEL_BASE_URL/v1/chat/completions` 发一条 chat 请求，确认能返回 content',
  '开启 `PM_AGENT_DEBUG=true` 可在失败消息中看到模型原始响应摘要',
];

export async function notifyPmFailure(
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
    skillsHint: '产品 PM 配置',
  });
  const body = buildAgentFailureMessage({
    agentLabel: 'PM Agent',
    reason,
    member,
    debug:
      process.env.PM_AGENT_DEBUG === 'true' ? opts?.debug : undefined,
    hints: opts?.hints ?? PM_DEBUG_HINTS,
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
