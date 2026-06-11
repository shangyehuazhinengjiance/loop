import type { LoopContext } from '@loop/shared';
import type { ResolvedModelConfig } from '@loop/shared';

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

async function callSummaryLlm(
  model: ResolvedModelConfig,
  system: string,
  user: string,
  maxTokens = 2048,
): Promise<string> {
  if (!model.apiKey || !model.baseUrl) {
    throw new Error('需求总结 LLM 未配置（PM_MODEL_API_KEY / PM_MODEL_BASE_URL）');
  }

  const res = await fetch(chatCompletionsUrl(model.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify({
      model: model.fastModel ?? model.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`需求总结 LLM 失败 (${res.status}): ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('需求总结 LLM 返回为空');
  return content;
}

export async function generateLoopDeliverySummary(input: {
  loopId: string;
  loopTitle: string;
  context: LoopContext;
  model: ResolvedModelConfig;
}): Promise<string> {
  const system = `你是项目需求文档助手。根据单个 Loop 的 PRD、任务与部署信息，输出该 Loop 的交付总结（Markdown，中文，800 字以内）。

结构：
## Loop 概述
## 需求要点
## 实现与任务完成情况
## 部署与验证
## 遗留事项（无则写「无」）`;

  const prd = input.context.prd;
  const imported = input.context.inputRequirements;
  const tasks = input.context.tasks ?? [];
  const dep = input.context.deployment;

  const user = [
    `Loop ID: ${input.loopId}`,
    `标题: ${input.loopTitle}`,
    imported
      ? `## 创建时导入的需求\n${imported.title}\n路径: ${imported.gitPath}\n${imported.content}`
      : '',
    prd ? `## PRD\n${prd.title}\n${prd.content}` : '## PRD\n（无）',
    tasks.length
      ? `## 任务\n${tasks.map((t) => `- [${t.status}] ${t.title}: ${t.description}`).join('\n')}`
      : '## 任务\n（无）',
    dep
      ? `## 部署\n分支: ${dep.targetBranch ?? '-'} commit: ${dep.commitSha?.slice(0, 8) ?? '-'}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return callSummaryLlm(input.model, system, user);
}

export async function mergeProjectRequirementsSummary(input: {
  projectName: string;
  existingSummary: string | null;
  loopId: string;
  loopTitle: string;
  loopSummary: string;
  model: ResolvedModelConfig;
}): Promise<string> {
  const system = `你是项目级需求文档维护助手。将新完成的 Loop 交付总结合并进「项目需求文档总结」，供后续 Loop 的 PM Agent 阅读。

要求：
- 使用中文 Markdown
- 控制在 2500 字以内
- 结构建议：
  ## 项目概览
  ## 已实现能力（按 Loop / 功能归纳）
  ## 进行中与规划
  ## 关键约束与约定
- 去重、合并同类项，保留历史 Loop 要点
- 只根据提供材料归纳，不要编造`;

  const user = [
    `项目名称: ${input.projectName}`,
    input.existingSummary
      ? `## 当前项目需求文档总结\n${input.existingSummary}`
      : '## 当前项目需求文档总结\n（尚无，请根据本 Loop 创建首版）',
    `## 本 Loop 交付总结（${input.loopId}：${input.loopTitle}）\n${input.loopSummary}`,
    '请输出更新后的完整项目需求文档总结。',
  ].join('\n\n');

  return callSummaryLlm(input.model, system, user, 3000);
}
