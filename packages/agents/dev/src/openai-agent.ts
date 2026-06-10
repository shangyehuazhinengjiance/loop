import type { ResolvedModelConfig } from '@loop/shared';
import { buildDevPrompt } from './prompts.js';
import type { OrchestratorApi } from './orchestrator-api.js';
import { DEV_TOOL_DEFINITIONS, executeDevTool, toolProgressMessage } from './tools.js';

const OPENAI_SYSTEM_SUFFIX = `
## 工具使用
你可通过 function calling 使用 read_file、write_file、edit_file、bash、glob、grep。
- 先读代码库摘要和关键文件，再动手改
- 每次改完后用 bash 跑相关测试
- 全部完成后用自然语言总结改动，并提示人类点击「验收通过」`;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatCompletionResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }[];
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/$/, '');
  if (trimmed.endsWith('/v1')) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function maxTurns(): number {
  const n = parseInt(process.env.DEV_AGENT_MAX_TURNS ?? '30', 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export async function runDevAgentOpenAI(input: {
  api: OrchestratorApi;
  loopId: string;
  phase: string;
  title: string;
  context: Parameters<typeof buildDevPrompt>[0];
  workspacePath: string;
  model: ResolvedModelConfig;
  signal?: AbortSignal;
}): Promise<void> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: buildDevPrompt(input.context, input.title) + OPENAI_SYSTEM_SUFFIX,
    },
    {
      role: 'user',
      content: '请根据 PRD 和任务列表开始开发。先阅读 .loop/codebase-summary.md（若存在）。',
    },
  ];

  const url = chatCompletionsUrl(input.model.baseUrl!);
  let finalText = '';

  for (let turn = 0; turn < maxTurns(); turn++) {
    if (input.signal?.aborted) break;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.model.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model.model,
        messages,
        tools: DEV_TOOL_DEFINITIONS,
        tool_choice: 'auto',
        temperature: 0.2,
      }),
      signal: input.signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Dev LLM failed (${res.status}): ${body.slice(0, 800)}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const assistant = data.choices?.[0]?.message;
    if (!assistant) {
      throw new Error('Dev LLM returned empty choice');
    }

    const toolCalls = assistant.tool_calls ?? [];
    messages.push({
      role: 'assistant',
      content: assistant.content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    if (toolCalls.length === 0) {
      finalText = assistant.content?.trim() ?? '开发完成';
      break;
    }

    for (const call of toolCalls) {
      const name = call.function.name;
      const args = parseToolArgs(call.function.arguments);
      const progress = toolProgressMessage(name, args);
      await input.api.postAgentMessage(
        input.loopId,
        { type: progress.type, body: progress.body },
        input.phase,
        `tool:${name}`,
      );
      await input.api.postAudit(input.loopId, {
        agent: 'dev-agent',
        action: `tool:${name}`,
        detail: { input: args },
      });

      const result = await executeDevTool(input.workspacePath, name, args);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.output,
      });
    }

    if (turn === maxTurns() - 1) {
      finalText = assistant.content?.trim() || '已达到最大工具轮次，请检查工作区改动。';
    }
  }

  await input.api.postAgentMessage(
    input.loopId,
    {
      type: 'text',
      body: finalText || '开发完成',
      actions: [{ id: 'approve-dev', label: '验收通过', action: 'approve_dev' }],
    },
    input.phase,
    'result',
  );
}
