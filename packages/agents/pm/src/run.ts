import Anthropic from '@anthropic-ai/sdk';
import { REQUEST_HUMAN_HELP_ANTHROPIC_TOOL, type ResolvedModelConfig } from '@loop/shared';
import { buildPMUserPrompt, PM_SYSTEM_PROMPT } from './prompts.js';
import { handlePmHumanHelp } from './human-help.js';
import { OrchestratorApi, parsePrdAndTasks } from './orchestrator-api.js';

export interface RunPmAgentInput {
  loopId: string;
  orchestratorUrl: string;
  model: ResolvedModelConfig;
  memberRoster?: string;
  requirement?: string;
  signal?: AbortSignal;
}

export async function runPmAgent(input: RunPmAgentInput): Promise<void> {
  if (input.signal?.aborted) return;

  const api = new OrchestratorApi(input.orchestratorUrl);
  const loop = await api.getLoop(input.loopId);
  const messages = await api.getMessages(input.loopId);

  const humanMessages = messages
    .filter((m) => m.sender.type === 'human')
    .map((m) => `${m.sender.displayName}: ${m.content.body}`)
    .join('\n');

  const requirement =
    input.requirement ??
    humanMessages.split('\n').pop() ??
    loop.title;

  const client = new Anthropic({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseUrl,
  });

  const userContent = buildPMUserPrompt({
    requirement,
    existingPrd: loop.context.prd?.content,
    chatHistory: humanMessages,
    memberRoster: input.memberRoster,
  });

  let response = await client.messages.create({
    model: input.model.model,
    max_tokens: input.model.extra?.max_tokens
      ? parseInt(input.model.extra.max_tokens, 10)
      : 8192,
    system: PM_SYSTEM_PROMPT,
    tools: [REQUEST_HUMAN_HELP_ANTHROPIC_TOOL],
    messages: [{ role: 'user', content: userContent }],
  });

  if (response.stop_reason === 'tool_use') {
    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'request_human_help') {
        await handlePmHumanHelp(
          api,
          input.loopId,
          loop.phase,
          block.input as never,
        );
        return;
      }
    }
    await api.postAgentMessage(
      input.loopId,
      {
        type: 'text',
        body: 'PM Agent 调用了未支持的工具，未生成 PRD。请重试 @pm-agent。',
      },
      loop.phase,
    );
    return;
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
    .join('\n')
    .trim();

  if (!text) {
    await api.postAgentMessage(
      input.loopId,
      {
        type: 'text',
        body: 'PM Agent 未返回有效文本（模型响应为空）。请重试 @pm-agent，或检查 PM_MODEL_BASE_URL / PM_MODEL_NAME 配置。',
      },
      loop.phase,
    );
    return;
  }

  const { prd, tasks } = parsePrdAndTasks(text);

  await api.updateContext(input.loopId, {
    ...loop.context,
    prd,
    tasks,
  });

  await api.postAgentMessage(
    input.loopId,
    {
      type: 'artifact',
      body: text,
      actions: [
        {
          id: 'approve-prd',
          label: '确认需求',
          action: 'approve_prd',
        },
      ],
    },
    loop.phase,
  );
}
