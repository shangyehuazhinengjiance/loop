import type { LoopMember, ResolvedModelConfig } from '@loop/shared';
import { fetchWithTimeout, REQUEST_HUMAN_HELP_OPENAI_TOOL } from '@loop/shared';
import { finishPmLoopEntry } from './finish-loop-entry.js';
import { finishPmPrd } from './finish-prd.js';
import { summarizeOpenAIResponse } from './debug.js';
import { handlePmHumanHelp } from './human-help.js';
import { notifyPmFailure } from './notify-failure.js';
import { PM_SYSTEM_PROMPT } from './prompts.js';
import type { OrchestratorApi } from './orchestrator-api.js';

interface ChatCompletionResponse {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: {
        id: string;
        function: { name: string; arguments: string };
      }[];
    };
  }[];
  error?: { message?: string };
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

export async function runPmAgentOpenAI(input: {
  api: OrchestratorApi;
  loopId: string;
  phase: string;
  userContent: string;
  memberRoster?: string;
  members: LoopMember[];
  triggeredByUserId?: string;
  model: ResolvedModelConfig;
  signal?: AbortSignal;
  isLoopEntry?: boolean;
}): Promise<void> {
  const url = chatCompletionsUrl(input.model.baseUrl!);
  const system = [
    PM_SYSTEM_PROMPT,
    input.memberRoster ? `## Loop 成员\n${input.memberRoster}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const maxTokens = input.isLoopEntry
    ? parseInt(process.env.PM_LOOP_ENTRY_MAX_TOKENS ?? '1536', 10)
    : input.model.extra?.max_tokens
      ? parseInt(input.model.extra.max_tokens, 10)
      : 8192;

  const timeoutMs = parseInt(
    process.env.PM_LLM_TIMEOUT_MS ??
      process.env.LLM_FETCH_TIMEOUT_MS ??
      '180000',
    10,
  );

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.model.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: input.userContent },
        ],
        tools: [REQUEST_HUMAN_HELP_OPENAI_TOOL],
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
      signal: input.signal,
      timeoutMs,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await notifyPmFailure(
      input.api,
      input.loopId,
      input.phase,
      detail.includes('超时') ? detail : `LLM 请求异常：${detail}`,
      input.members,
      {
        preferUserId: input.triggeredByUserId,
        hints: [
          '检查 PM_MODEL_BASE_URL / PM_MODEL_API_KEY 是否可达',
          `当前超时 ${timeoutMs}ms，可调大 PM_LLM_TIMEOUT_MS`,
        ],
      },
    );
    return;
  }

  const rawText = await res.text();
  let data: ChatCompletionResponse;
  try {
    data = JSON.parse(rawText) as ChatCompletionResponse;
  } catch {
    await notifyPmFailure(
      input.api,
      input.loopId,
      input.phase,
      `LLM 返回非 JSON（HTTP ${res.status}）`,
      input.members,
      {
        preferUserId: input.triggeredByUserId,
        debug: rawText.slice(0, 800),
      },
    );
    return;
  }

  if (!res.ok) {
    await notifyPmFailure(
      input.api,
      input.loopId,
      input.phase,
      `LLM 请求失败（HTTP ${res.status}）`,
      input.members,
      {
        preferUserId: input.triggeredByUserId,
        debug: summarizeOpenAIResponse(data),
      },
    );
    return;
  }

  const assistant = data.choices?.[0]?.message;
  const toolCalls = assistant?.tool_calls ?? [];

  if (toolCalls.length > 0) {
    for (const call of toolCalls) {
      if (call.function.name === 'request_human_help') {
        await handlePmHumanHelp(
          input.api,
          input.loopId,
          input.phase,
          parseToolArgs(call.function.arguments) as never,
        );
        return;
      }
    }
    await notifyPmFailure(
      input.api,
      input.loopId,
      input.phase,
      '调用了未支持的工具，未生成 PRD',
      input.members,
      {
        preferUserId: input.triggeredByUserId,
        debug: summarizeOpenAIResponse(data),
      },
    );
    return;
  }

  const text = assistant?.content?.trim() ?? '';
  if (!text) {
    await notifyPmFailure(
      input.api,
      input.loopId,
      input.phase,
      '模型响应为空（无 content 文本）',
      input.members,
      {
        preferUserId: input.triggeredByUserId,
        debug: summarizeOpenAIResponse(data),
      },
    );
    return;
  }

  if (input.isLoopEntry) {
    await finishPmLoopEntry(input.api, input.loopId, input.phase, text);
    return;
  }

  await finishPmPrd(input.api, input.loopId, input.phase, text);
}
