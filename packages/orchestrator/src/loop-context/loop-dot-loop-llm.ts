import type { LoopContext, LoopDotLoopBundle } from '@loop/shared';
import type { ResolvedModelConfig } from '@loop/shared';

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function parseJsonBlock(text: string): Record<string, string> {
  const fence = text.match(/```json\n([\s\S]*?)```/);
  const raw = fence?.[1]?.trim() ?? text.trim();
  return JSON.parse(raw) as Record<string, string>;
}

export async function generateUpdatedLoopDotFiles(input: {
  projectName: string;
  loopId: string;
  loopTitle: string;
  context: LoopContext;
  chatExcerpt: string;
  existing: LoopDotLoopBundle;
  model: ResolvedModelConfig;
}): Promise<LoopDotLoopBundle> {
  if (!input.model.apiKey || !input.model.baseUrl) {
    throw new Error('LLM 未配置（PM_MODEL_API_KEY / PM_MODEL_BASE_URL）');
  }

  const system = `你是 Loop 项目知识库维护助手。根据本 Loop 的交付结果，更新仓库 \`.loop/\` 下四个 Markdown 文件。

输出必须是单个 JSON 对象（可包在 \`\`\`json 代码块中），字段：
- readme：项目整体介绍（面向新人，300-800 字）
- design：技术架构要点（基于现有 DESIGN 增量更新，勿删除仍有效的架构描述）
- history：历史对话与 Loop 脉络（**有损压缩**，合并旧 HISTORY + 本 Loop 关键决策/结论，控制在 1500 字内）
- memory：用户偏好、习惯、约束（**有损压缩**，合并旧 MEMORY + 本 Loop 新发现，控制在 800 字内）

规则：
- 使用中文 Markdown 正文（不要 YAML front matter）
- 只根据提供的材料归纳，不要编造未实现的功能
- 新仓库若某文件为空，可创建合理初版`;

  const prd = input.context.prd;
  const tasks = input.context.tasks ?? [];
  const dep = input.context.deployment;

  const user = [
    `项目：${input.projectName}`,
    `Loop：${input.loopId} — ${input.loopTitle}`,
    '',
    '## 当前 .loop 文件',
    `README:\n${input.existing.readme || '（无）'}`,
    `DESIGN:\n${input.existing.design || '（无）'}`,
    `HISTORY:\n${input.existing.history || '（无）'}`,
    `MEMORY:\n${input.existing.memory || '（无）'}`,
    '',
    input.context.inputRequirements
      ? `## 导入需求\n${input.context.inputRequirements.content.slice(0, 4000)}`
      : '',
    prd ? `## PRD\n${prd.content.slice(0, 6000)}` : '',
    tasks.length
      ? `## 任务\n${tasks.map((t) => `- [${t.status}] ${t.title}`).join('\n')}`
      : '',
    dep ? `## 部署\n${JSON.stringify({ step: dep.step, targetBranch: dep.targetBranch })}` : '',
    input.chatExcerpt
      ? `## 群聊摘录（关键人类发言）\n${input.chatExcerpt.slice(0, 4000)}`
      : '',
    '',
    '请输出更新后的四个文件 JSON。',
  ]
    .filter(Boolean)
    .join('\n');

  const res = await fetch(chatCompletionsUrl(input.model.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.model.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model.fastModel ?? input.model.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 8192,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`.loop 更新 LLM 失败 (${res.status}): ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('.loop 更新 LLM 返回为空');

  const parsed = parseJsonBlock(content);
  return {
    readme: parsed.readme ?? input.existing.readme,
    design: parsed.design ?? input.existing.design,
    history: parsed.history ?? input.existing.history,
    memory: parsed.memory ?? input.existing.memory,
    existing: {
      readme: true,
      design: true,
      history: true,
      memory: true,
    },
  };
}
