import type { ResolvedModelConfig } from '@loop/shared';
import { buildDevPrompt } from './prompts.js';
import type { OrchestratorApi } from './orchestrator-api.js';
import {
  DEV_TOOL_DEFINITIONS,
  REQUEST_HUMAN_HELP_TOOL,
  executeDevTool,
  toolProgressMessage,
} from './tools.js';

const OPENAI_SYSTEM_SUFFIX = `
## 工具使用
你可通过 function calling 使用 read_file、write_file、edit_file、bash、glob、grep、request_human_help。
- 先读代码库摘要和关键文件，再动手改
- 每次改完后用 bash 跑相关测试
- 权限/环境/业务问题无法自行解决时，用 request_human_help @ 名册中的成员（bio 为空的成员可接各类问题）
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
  memberRoster?: string;
  model: ResolvedModelConfig;
  signal?: AbortSignal;
}): Promise<void> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        buildDevPrompt(input.context, input.title, input.memberRoster) +
        OPENAI_SYSTEM_SUFFIX,
    },
    {
      role: 'user',
      content:
        '请根据 PRD 和任务列表开始开发。可先尝试 read_file 读取 .loop/codebase-summary.md；若不存在则直接 glob/README 了解项目结构。',
    },
  ];

  const url = chatCompletionsUrl(input.model.baseUrl!);
  const tools = [...DEV_TOOL_DEFINITIONS, REQUEST_HUMAN_HELP_TOOL];
  let finalText = '';
  let humanBlocked = false;
  let toolsExecuted = 0;

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
        tools,
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
      const text = assistant.content?.trim() ?? '';
      // 模型只说话不调工具：继续推进，避免首轮就误发「验收通过」
      if (toolsExecuted === 0 && turn < maxTurns() - 1) {
        if (text) {
          await input.api.postAgentMessage(
            input.loopId,
            { type: 'text', body: text },
            input.phase,
            'assistant',
          );
        }
        messages.push({
          role: 'user',
          content:
            '请使用 read_file / write_file / edit_file / bash 等工具实际执行开发任务，不要只描述计划。全部完成并跑过测试后再给出总结。',
        });
        continue;
      }
      finalText = text || (toolsExecuted > 0 ? '开发完成' : '未达到最低工具执行要求');
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
        const kind = String(args.kind ?? 'human_fix');
        const reason = String(args.reason ?? '');
        const question = args.question ? String(args.question) : undefined;
        await input.api.requestHumanHelp(input.loopId, {
          requestedBy: 'dev-agent',
          kind,
          reason,
          question,
          assigneeUserId,
          skillsHint,
        });
        humanBlocked = true;
        finalText = `已请求人工协助：${reason}`;
        break;
      }

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
      toolsExecuted += 1;
    }

    if (humanBlocked) break;

    if (turn === maxTurns() - 1) {
      finalText = assistant.content?.trim() || '已达到最大工具轮次，请检查工作区改动。';
    }
  }

  const canApprove = !humanBlocked && toolsExecuted > 0;
  await input.api.postAgentMessage(
    input.loopId,
    {
      type: canApprove ? 'artifact' : 'text',
      body:
        finalText ||
        (canApprove
          ? '开发完成'
          : '开发未完成：模型未实际调用工具。请重试 @dev-agent。'),
      actions: canApprove
        ? [{ id: 'approve-dev', label: '验收通过', action: 'approve_dev' }]
        : undefined,
    },
    input.phase,
    humanBlocked ? 'blocked' : canApprove ? 'result' : 'incomplete',
  );
}
