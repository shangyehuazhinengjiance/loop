import { fetchWithTimeout, type ResolvedModelConfig } from '@loop/shared';
import type { WorkspaceSnapshot } from './workspace-scanner.js';

const SYSTEM_PROMPT = `你是代码库分析助手。根据目录树和关键配置文件，输出一份简洁的 Markdown 代码库摘要，供后续 AI 开发 Agent 快速理解项目，减少盲目扫描仓库。

要求：
- 使用中文
- 控制在 1500 字以内
- 结构固定包含以下章节（无内容则写「无」）：
  ## 项目概述
  ## 技术栈
  ## 目录结构要点
  ## 核心模块与职责
  ## 构建与测试命令
  ## 开发注意事项
- 只根据提供的材料推断，不要编造不存在的模块
- 不要输出代码块外的多余解释`;

function buildUserPrompt(snapshot: WorkspaceSnapshot): string {
  const files = snapshot.keyFiles
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join('\n\n');

  return `## 目录树（节选）
\`\`\`
${snapshot.tree}
\`\`\`

## 关键文件内容
${files || '（无关键配置文件）'}`;
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

export async function generateCodebaseSummary(
  snapshot: WorkspaceSnapshot,
  model: ResolvedModelConfig,
): Promise<string> {
  if (!model.apiKey) {
    throw new Error('No API key for codebase summary (PM_MODEL_API_KEY)');
  }
  if (!model.baseUrl) {
    throw new Error('No base URL for codebase summary (PM_MODEL_BASE_URL)');
  }

  const res = await fetchWithTimeout(chatCompletionsUrl(model.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify({
      model: model.fastModel ?? model.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(snapshot) },
      ],
      max_tokens: 2048,
      temperature: 0.2,
    }),
    timeoutMs: parseInt(process.env.LLM_FETCH_TIMEOUT_MS ?? '180000', 10),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Summary LLM failed (${res.status}): ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Summary LLM returned empty content');
  }
  return content;
}
