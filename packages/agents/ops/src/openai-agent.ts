import type { LoopMember, ResolvedModelConfig } from '@loop/shared';
import {
  DEV_TOOL_DEFINITIONS,
  executeDevTool,
  REQUEST_HUMAN_HELP_TOOL,
} from '@loop/agent-dev';
import { isMeaninglessOpsResult, summarizeOpenAIResponse } from './debug.js';
import { notifyOpsFailure } from './notify-failure.js';
import { buildOpsPrompt } from './prompts.js';
import type { OrchestratorApi } from './orchestrator-api.js';

const OPS_TOOL_NAMES = new Set(['read_file', 'bash', 'glob', 'grep']);
const OPS_TOOLS = [
  ...DEV_TOOL_DEFINITIONS.filter((t) => OPS_TOOL_NAMES.has(t.function.name)),
  REQUEST_HUMAN_HELP_TOOL,
];

const OPENAI_SYSTEM_SUFFIX = `
## 工具使用
你可通过 function calling 使用 read_file、bash、glob、grep、request_human_help。
- 先读 Dockerfile、CI 配置等运维相关文件
- 权限/环境/审批问题无法自行解决时，用 request_human_help @ 名册中的成员
- 部署完成后在回复中给出 staging URL`;

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
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
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

function maxTurns(): number {
  const n = parseInt(process.env.OPS_AGENT_MAX_TURNS ?? '25', 10);
  return Number.isFinite(n) && n > 0 ? n : 25;
}

export async function runOpsAgentOpenAI(input: {
  api: OrchestratorApi;
  loopId: string;
  phase: string;
  title: string;
  context: Parameters<typeof buildOpsPrompt>[0];
  workspacePath: string;
  memberRoster?: string;
  members: LoopMember[];
  triggeredByUserId?: string;
  model: ResolvedModelConfig;
  signal?: AbortSignal;
}): Promise<void> {
  const fail = (reason: string, debug?: string) =>
    notifyOpsFailure(
      input.api,
      input.loopId,
      input.phase,
      reason,
      input.members,
      { preferUserId: input.triggeredByUserId, debug },
    );

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        buildOpsPrompt(input.context, input.title, input.memberRoster) +
        OPENAI_SYSTEM_SUFFIX,
    },
    {
      role: 'user',
      content:
        '请根据当前部署状态完成 staging 部署准备。先读取工作区中的 Dockerfile 与 CI 配置。',
    },
  ];

  const url = chatCompletionsUrl(input.model.baseUrl!);
  let finalText = '';
  let humanBlocked = false;

  for (let turn = 0; turn < maxTurns(); turn++) {
    if (input.signal?.aborted) return;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.model.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model.model,
        messages,
        tools: OPS_TOOLS,
        tool_choice: 'auto',
        temperature: 0.2,
      }),
      signal: input.signal,
    });

    const rawText = await res.text();
    let data: ChatCompletionResponse;
    try {
      data = JSON.parse(rawText) as ChatCompletionResponse;
    } catch {
      await fail(`LLM 返回非 JSON（HTTP ${res.status}）`, rawText.slice(0, 800));
      return;
    }

    if (!res.ok) {
      await fail(`LLM 请求失败（HTTP ${res.status}）`, summarizeOpenAIResponse(data));
      return;
    }

    const assistant = data.choices?.[0]?.message;
    if (!assistant) {
      await fail('LLM 返回空 choice', summarizeOpenAIResponse(data));
      return;
    }

    const toolCalls = assistant.tool_calls ?? [];
    messages.push({
      role: 'assistant',
      content: assistant.content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    if (toolCalls.length === 0) {
      finalText = assistant.content?.trim() ?? '';
      break;
    }

    for (const call of toolCalls) {
      const name = call.function.name;
      const args = parseToolArgs(call.function.arguments);

      if (name === 'request_human_help') {
        const assigneeUserId = args.assignee_user_id
          ? String(args.assignee_user_id)
          : undefined;
        const skillsHint = args.skills_hint ? String(args.skills_hint) : undefined;
        await input.api.requestHumanHelp(input.loopId, {
          requestedBy: 'ops-agent',
          kind: String(args.kind ?? 'human_fix'),
          reason: String(args.reason ?? ''),
          question: args.question ? String(args.question) : undefined,
          assigneeUserId,
          skillsHint,
        });
        humanBlocked = true;
        finalText = `已请求人工协助：${args.reason ?? ''}`;
        break;
      }

      if (name === 'bash') {
        const cmd = String(args.command ?? '');
        if (/prod(uction)?/i.test(cmd) && !process.env.OPS_ALLOW_PROD) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: 'Error: Production deploy requires Human approval (OPS_ALLOW_PROD)',
          });
          continue;
        }
        await input.api.postAudit(input.loopId, 'bash', { command: cmd });
      }

      let result;
      try {
        result = await executeDevTool(input.workspacePath, name, args);
      } catch (err) {
        result = {
          output: `Error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: result.output,
      });
    }

    if (humanBlocked) break;

    if (turn === maxTurns() - 1) {
      finalText = assistant.content?.trim() ?? '';
    }
  }

  if (humanBlocked) {
    await input.api.postAgentMessage(
      input.loopId,
      { type: 'text', body: finalText },
      input.phase,
    );
    return;
  }

  if (isMeaninglessOpsResult(finalText)) {
    await fail(
      '模型响应为空或无实质内容（未生成部署说明）',
      `finalText=${JSON.stringify(finalText)}`,
    );
    return;
  }

  const stagingMatch = finalText.match(/https?:\/\/[^\s]+/);
  const loop = await input.api.getLoop(input.loopId);
  const deployment = {
    ...loop.context.deployment,
    stagingUrl: stagingMatch?.[0] ?? loop.context.deployment?.stagingUrl,
    status: 'staging' as const,
  };
  await input.api.updateContext(input.loopId, {
    ...loop.context,
    deployment,
  });

  await input.api.postAgentMessage(
    input.loopId,
    {
      type: 'artifact',
      body: finalText,
      actions: [{ id: 'approve-deploy', label: '确认发布', action: 'approve_deploy' }],
    },
    input.phase,
  );
}
