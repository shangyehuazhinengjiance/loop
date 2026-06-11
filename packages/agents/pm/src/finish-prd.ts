import type { OrchestratorApi } from './orchestrator-api.js';
import { parsePrdAndTasks } from './orchestrator-api.js';
import { previewText } from './pm-progress.js';

export async function finishPmPrd(
  api: OrchestratorApi,
  loopId: string,
  phase: string,
  text: string,
): Promise<void> {
  await api.reportProgress(loopId, phase, {
    label: 'PRD 与任务列表已生成',
    detail: previewText(text, 600),
    updateBanner: false,
  });

  const loop = await api.getLoop(loopId);
  await api.reportProgress(loopId, phase, {
    label: '正在保存到 Loop 上下文…',
    updateBanner: false,
  });
  const { prd, tasks } = parsePrdAndTasks(text);
  await api.updateContext(loopId, { ...loop.context, prd, tasks });
  await api.postAgentMessage(
    loopId,
    {
      type: 'artifact',
      body: text,
      actions: [{ id: 'approve-prd', label: '确认需求', action: 'approve_prd' }],
    },
    phase,
  );
}
