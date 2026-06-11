import type { LoopRecord } from './orchestrator-api.js';
import type { OrchestratorApi } from './orchestrator-api.js';

export async function reportPmPreLlmProgress(
  api: OrchestratorApi,
  loop: LoopRecord,
  opts: {
    isLoopEntry?: boolean;
    loopDotLoopContext?: string;
  },
): Promise<void> {
  const notes: string[] = [];
  if (opts.loopDotLoopContext?.trim()) {
    notes.push('- 已加载 **`.loop/` 项目知识库**（README / DESIGN / HISTORY / MEMORY）');
  } else {
    notes.push('- 尚无 `.loop/` 知识库（首个或早期 Loop）');
  }
  if (loop.context.inputRequirements) {
    notes.push(
      `- 已加载**导入需求**：\`${loop.context.inputRequirements.gitPath}\``,
    );
  }

  await api.reportProgress(loop.id, loop.phase, {
    label: opts.isLoopEntry
      ? '正在读取 .loop 项目知识库与导入需求…'
      : '正在整理 .loop 知识库与群聊上下文…',
    detail: notes.join('\n'),
  });

  await api.reportProgress(loop.id, loop.phase, {
    label: opts.isLoopEntry
      ? '正在生成欢迎语…'
      : '正在调用大模型整理 PRD…',
    detail: opts.isLoopEntry
      ? '模型将基于 .loop 知识库生成简短欢迎语，请稍候。'
      : '模型将分析上述材料并生成 PRD 与任务列表，请稍候。',
  });
}

export function previewText(text: string, max = 800): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…\n\n（完整内容见下方消息与代码仓库）`;
}
