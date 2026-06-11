import type { OrchestratorApi } from './orchestrator-api.js';
import { previewText } from './pm-progress.js';

export async function finishPmLoopEntry(
  api: OrchestratorApi,
  loopId: string,
  phase: string,
  text: string,
): Promise<void> {
  await api.reportProgress(loopId, phase, {
    label: '大模型总结完成',
    detail: previewText(text),
  });

  try {
    await api.saveUnderstanding(loopId, text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await api.reportProgress(loopId, phase, {
      label: '写入代码仓库失败',
      detail: `${msg}\n\n理解纪要仍会在群聊中展示，可稍后重试或手动保存。`,
      updateBanner: false,
    });
  }

  await api.postAgentMessage(loopId, { type: 'text', body: text }, phase);
}
