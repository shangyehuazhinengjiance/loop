import type { LoopContext, LoopDotLoopBundle, LoopDotFileKey } from '@loop/shared';
import type { ResolvedModelConfig } from '@loop/shared';

const INPUT_MAX_CHARS = parseInt(process.env.LOOP_DOT_LLM_INPUT_MAX_CHARS ?? '6000', 10);

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function truncateForLlm(text: string, max = INPUT_MAX_CHARS): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const head = Math.floor(max * 0.65);
  const tail = max - head - 40;
  return `${trimmed.slice(0, head)}\n\n…（中间 ${trimmed.length - head - tail} 字已省略）\n\n${trimmed.slice(-tail)}`;
}

function stripModelWrappers(text: string): string {
  let out = text.trim();
  const fence = out.match(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/);
  if (fence?.[1]) out = fence[1].trim();
  return out.replace(/^<!--[\s\S]*?-->\n*/gm, '').trim();
}

/** 分隔符格式兜底解析（兼容旧 prompt） */
function parseDelimiterSections(text: string): Partial<Record<LoopDotFileKey, string>> {
  const keys: { marker: string; key: LoopDotFileKey }[] = [
    { marker: '---LOOP_README---', key: 'readme' },
    { marker: '---LOOP_DESIGN---', key: 'design' },
    { marker: '---LOOP_HISTORY---', key: 'history' },
    { marker: '---LOOP_MEMORY---', key: 'memory' },
  ];
  const result: Partial<Record<LoopDotFileKey, string>> = {};
  for (let i = 0; i < keys.length; i++) {
    const { marker, key } = keys[i]!;
    const start = text.indexOf(marker);
    if (start < 0) continue;
    const contentStart = start + marker.length;
    const nextMarker = keys[i + 1]?.marker;
    const end =
      nextMarker && text.indexOf(nextMarker, contentStart) >= 0
        ? text.indexOf(nextMarker, contentStart)
        : text.length;
    result[key] = text.slice(contentStart, end).trim();
  }
  return result;
}

async function callLoopDotLlm(
  model: ResolvedModelConfig,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  if (!model.apiKey || !model.baseUrl) {
    throw new Error('LLM 未配置（PM_MODEL_API_KEY / PM_MODEL_BASE_URL）');
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
    throw new Error(`.loop 更新 LLM 失败 (${res.status}): ${body.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content?.trim();
  if (!content) throw new Error('.loop 更新 LLM 返回为空');
  if (choice?.finish_reason === 'length') {
    console.warn('[loop-dot-loop] LLM output truncated (finish_reason=length)');
  }
  return stripModelWrappers(content);
}

function buildLoopContextBlock(input: {
  projectName: string;
  loopId: string;
  loopTitle: string;
  context: LoopContext;
  chatExcerpt: string;
}): string {
  const prd = input.context.prd;
  const tasks = input.context.tasks ?? [];
  const dep = input.context.deployment;

  return [
    `项目：${input.projectName}`,
    `Loop：${input.loopId} — ${input.loopTitle}`,
    prd ? `## PRD\n${truncateForLlm(prd.content, 5000)}` : '',
    tasks.length
      ? `## 任务\n${tasks.map((t) => `- [${t.status}] ${t.title}`).join('\n')}`
      : '',
    dep
      ? `## 部署\n${JSON.stringify({ step: dep.step, targetBranch: dep.targetBranch })}`
      : '',
    input.chatExcerpt
      ? `## 群聊摘录\n${truncateForLlm(input.chatExcerpt, 3000)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function mergeDesign(
  existing: string,
  updated: string,
  loopId: string,
  loopTitle: string,
): string {
  const body = updated.trim();
  if (!body) return existing;
  if (!existing.trim() || existing.length < 2500) return body;

  const section = `## Loop ${loopId.slice(0, 8)}：${loopTitle}`;
  if (existing.includes(section)) {
    return existing.replace(
      new RegExp(`${section}[\\s\\S]*?(?=\\n## Loop |$)`),
      `${section}\n\n${body}`,
    );
  }
  return `${existing.trim()}\n\n${section}\n\n${body}`;
}

async function updateReadme(
  input: Parameters<typeof generateUpdatedLoopDotFiles>[0],
  ctx: string,
): Promise<string> {
  const system = `你是 Loop 项目知识库助手。更新 README.md（项目整体介绍，中文 Markdown，300-800 字）。

只输出 Markdown 正文：
- 不要用 JSON
- 不要用 \`\`\` 代码块包裹
- 不要 YAML front matter`;

  const user = [
    ctx,
    '',
    '## 当前 README.md',
    truncateForLlm(input.existing.readme) || '（空）',
    '',
    '请输出更新后的完整 README.md 正文。',
  ].join('\n');

  return callLoopDotLlm(input.model, system, user, 2000);
}

async function updateDesign(
  input: Parameters<typeof generateUpdatedLoopDotFiles>[0],
  ctx: string,
): Promise<string> {
  const existing = input.existing.design;
  const isLarge = existing.trim().length >= 2500;

  const system = isLarge
    ? `你是 Loop 项目知识库助手。本 Loop 完成后，为 DESIGN.md **追加**架构增量说明（中文 Markdown，300-600 字）。

只输出本 Loop 的增量段落：
- 不要用 JSON 或代码块包裹
- 不要重复输出整份 DESIGN
- 聚焦本 Loop 引入的模块、接口、部署或技术决策`
    : `你是 Loop 项目知识库助手。输出完整 DESIGN.md 技术架构说明（中文 Markdown，可适当精简，2000 字以内）。

只输出 Markdown 正文，不要用 JSON 或代码块包裹。`;

  const user = [
    ctx,
    '',
    '## 当前 DESIGN.md',
    truncateForLlm(existing) || '（空）',
    '',
    isLarge
      ? `请输出 Loop \`${input.loopId}\` 的架构增量段落（将追加到 DESIGN 文末）。`
      : '请输出更新后的完整 DESIGN.md 正文。',
  ].join('\n');

  const raw = await callLoopDotLlm(input.model, system, user, 2500);
  return isLarge
    ? mergeDesign(existing, raw, input.loopId, input.loopTitle)
    : raw;
}

async function updateHistory(
  input: Parameters<typeof generateUpdatedLoopDotFiles>[0],
  ctx: string,
): Promise<string> {
  const system = `你是 Loop 项目知识库助手。更新 HISTORY.md（有损压缩，中文 Markdown，1500 字以内）。

合并旧 HISTORY 与本 Loop 关键决策/结论，去重、保留脉络。
只输出 Markdown 正文，不要用 JSON 或代码块包裹。`;

  const user = [
    ctx,
    '',
    '## 当前 HISTORY.md',
    truncateForLlm(input.existing.history) || '（空）',
    '',
    '请输出更新后的完整 HISTORY.md 正文。',
  ].join('\n');

  return callLoopDotLlm(input.model, system, user, 2500);
}

async function updateMemory(
  input: Parameters<typeof generateUpdatedLoopDotFiles>[0],
  ctx: string,
): Promise<string> {
  const system = `你是 Loop 项目知识库助手。更新 MEMORY.md（有损压缩，中文 Markdown，800 字以内）。

合并用户偏好、习惯、约束；只根据材料归纳，勿编造。
只输出 Markdown 正文，不要用 JSON 或代码块包裹。`;

  const user = [
    ctx,
    '',
    '## 当前 MEMORY.md',
    truncateForLlm(input.existing.memory) || '（空）',
    '',
    '请输出更新后的完整 MEMORY.md 正文。',
  ].join('\n');

  return callLoopDotLlm(input.model, system, user, 1500);
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
  const ctx = buildLoopContextBlock(input);

  const readme = await updateReadme(input, ctx);
  const design = await updateDesign(input, ctx);
  const history = await updateHistory(input, ctx);
  const memory = await updateMemory(input, ctx);

  return {
    readme: readme || input.existing.readme,
    design: design || input.existing.design,
    history: history || input.existing.history,
    memory: memory || input.existing.memory,
    existing: {
      readme: true,
      design: true,
      history: true,
      memory: true,
    },
  };
}

/** @internal exported for tests */
export function parseLoopDotLlmOutput(text: string): Partial<Record<LoopDotFileKey, string>> {
  return parseDelimiterSections(stripModelWrappers(text));
}
