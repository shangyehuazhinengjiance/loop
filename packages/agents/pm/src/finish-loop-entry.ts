import type { OrchestratorApi } from './orchestrator-api.js';
import { previewText } from './pm-progress.js';

export async function finishPmLoopEntry(
  api: OrchestratorApi,
  loopId: string,
  phase: string,
  text: string,
): Promise<void> {
  await api.reportProgress(loopId, phase, {
    label: '欢迎语生成完成',
    detail: previewText(text),
  });

  await api.postAgentMessage(loopId, { type: 'text', body: text }, phase);
}
