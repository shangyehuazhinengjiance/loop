import type { LoopRecord } from './orchestrator-api.js';
import type { OrchestratorApi } from './orchestrator-api.js';

export async function reportPmPreLlmProgress(
  api: OrchestratorApi,
  loop: LoopRecord,
  opts: {
    isLoopEntry?: boolean;
    projectRequirementsSummary?: string;
  },
): Promise<void> {
  const notes: string[] = [];
  if (opts.projectRequirementsSummary?.trim()) {
    notes.push('- 已加载**项目需求总结**（历史 Loop 累积）');
  } else {
    notes.push('- 尚无项目需求总结（首个或早期 Loop）');
  }
  if (loop.context.inputRequirements) {
    notes.push(
      `- 已加载**导入需求**：\`${loop.context.inputRequirements.gitPath}\``,
    );
  }

  await api.reportProgress(loop.id, loop.phase, {
    label: opts.isLoopEntry
      ? '正在读取项目背景与导入需求…'
      : '正在整理群聊上下文与需求材料…',
    detail: notes.join('\n'),
  });

  await api.reportProgress(loop.id, loop.phase, {
    label: opts.isLoopEntry
      ? '正在调用大模型理解需求…'
      : '正在调用大模型整理 PRD…',
    detail: `模型将分析上述材料并生成${opts.isLoopEntry ? '理解纪要' : ' PRD 与任务列表'}，请稍候。`,
  });
}

export function previewText(text: string, max = 800): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…\n\n（完整内容见下方消息与代码仓库）`;
}
