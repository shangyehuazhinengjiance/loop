import type { RequestHumanHelpArgs } from '@loop/shared';
import type { OrchestratorApi } from './orchestrator-api.js';

export async function handlePmHumanHelp(
  api: OrchestratorApi,
  loopId: string,
  phase: string,
  input: RequestHumanHelpArgs,
): Promise<void> {
  await api.requestHumanHelp(loopId, {
    requestedBy: 'pm-agent',
    kind: input.kind,
    reason: input.reason,
    question: input.question,
    assigneeUserId: input.assignee_user_id,
    skillsHint: input.skills_hint,
  });
  await api.postAgentMessage(
    loopId,
    {
      type: 'text',
      body: `已请求人工协助：${input.reason}`,
    },
    phase,
  );
}
