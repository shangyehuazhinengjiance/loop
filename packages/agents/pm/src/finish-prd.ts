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

  let gitNote = '';
  await api.reportProgress(loopId, phase, {
    label: '正在提交 PRD 到仓库…',
    updateBanner: false,
  });
  try {
    const published = await api.publishPrdToGit(loopId);
    if (published.hadChanges) {
      const short = published.commitSha.slice(0, 7);
      const pushNote = published.pushed ? '，已推送到远程' : '';
      gitNote = `\n\n---\n✅ PRD 已提交到仓库（\`${short}\`${pushNote}，分支 \`${published.branch ?? 'loop'}\`）`;
    } else {
      gitNote = '\n\n---\n（PRD 文件无变更，未产生新 commit）';
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    gitNote = `\n\n---\n⚠️ PRD 未能自动提交：${msg}`;
    console.warn(`publishPrdToGit failed: ${msg}`);
  }

  await api.postAgentMessage(
    loopId,
    {
      type: 'artifact',
      body: `${text}${gitNote}`,
      actions: [{ id: 'approve-prd', label: '确认需求', action: 'approve_prd' }],
    },
    phase,
  );

  await api.reportProgress(loopId, phase, {
    label: 'PRD 已生成，请确认需求',
    active: false,
    updateBanner: false,
  });
}
