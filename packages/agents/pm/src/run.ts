import Anthropic from '@anthropic-ai/sdk';
import {
  REQUEST_HUMAN_HELP_ANTHROPIC_TOOL,
  type LoopMember,
  type ResolvedModelConfig,
} from '@loop/shared';
import { summarizeAnthropicResponse } from './debug.js';
import { buildPMUserPrompt, PM_SYSTEM_PROMPT } from './prompts.js';
import { handlePmHumanHelp } from './human-help.js';
import { notifyPmFailure } from './notify-failure.js';
import { runPmAgentOpenAI } from './openai-agent.js';
import { OrchestratorApi, parsePrdAndTasks } from './orchestrator-api.js';

export interface RunPmAgentInput {
  loopId: string;
  orchestratorUrl: string;
  model: ResolvedModelConfig;
  memberRoster?: string;
  members?: LoopMember[];
  triggeredByUserId?: string;
  requirement?: string;
  projectRequirementsSummary?: string;
  isLoopEntry?: boolean;
  signal?: AbortSignal;
}

async function finishPmSuccess(
  api: OrchestratorApi,
  loopId: string,
  phase: string,
  text: string,
): Promise<void> {
  const loop = await api.getLoop(loopId);
  const { prd, tasks } = parsePrdAndTasks(text);
  await api.updateContext(loopId, { ...loop.context, prd, tasks });
  await api.postAgentMessage(
    loopId,
    {
      type: 'artifact',
      body: text,
      actions: [{ id: 'approve-prd', label: '确认需求', action: 'approve_prd' }],
    },
    phase,
  );
}

export async function runPmAgent(input: RunPmAgentInput): Promise<void> {
  if (input.signal?.aborted) return;

  const api = new OrchestratorApi(input.orchestratorUrl);
  const loop = await api.getLoop(input.loopId);
  const members = input.members ?? [];

  const messages = await api.getMessages(input.loopId);
  const humanMessages = messages
    .filter((m) => m.sender.type === 'human')
    .map((m) => `${m.sender.displayName}: ${m.content.body}`)
    .join('\n');

  const requirement =
    input.requirement ??
    humanMessages.split('\n').pop() ??
    loop.title;

  const userContent = buildPMUserPrompt({
    requirement,
    existingPrd: loop.context.prd?.content,
    chatHistory: humanMessages,
    memberRoster: input.memberRoster,
    projectRequirementsSummary: input.projectRequirementsSummary,
    isLoopEntry: input.isLoopEntry,
  });

  if (input.model.runtime === 'client-sdk') {
    if (!input.model.apiKey?.trim()) {
      await notifyPmFailure(
        api,
        input.loopId,
        loop.phase,
        'PM_MODEL_API_KEY 未配置',
        members,
        { preferUserId: input.triggeredByUserId },
      );
      return;
    }
    if (!input.model.baseUrl?.trim()) {
      await notifyPmFailure(
        api,
        input.loopId,
        loop.phase,
        'PM_MODEL_BASE_URL 未配置（client-sdk 必填）',
        members,
        { preferUserId: input.triggeredByUserId },
      );
      return;
    }
    console.info(
      `[pm-agent] loop=${input.loopId} runtime=client-sdk model=${input.model.model} baseUrl=${input.model.baseUrl}`,
    );
    await runPmAgentOpenAI({
      api,
      loopId: input.loopId,
      phase: loop.phase,
      userContent,
      memberRoster: input.memberRoster,
      members,
      triggeredByUserId: input.triggeredByUserId,
      model: input.model,
      signal: input.signal,
      isLoopEntry: input.isLoopEntry,
    });
    return;
  }

  if (!input.model.model.toLowerCase().includes('claude')) {
    await notifyPmFailure(
      api,
      input.loopId,
      loop.phase,
      `agent-sdk 仅支持 Claude，当前模型为 "${input.model.model}"`,
      members,
      {
        preferUserId: input.triggeredByUserId,
        hints: ['请设置 PM_AGENT_RUNTIME=client-sdk 以使用 OpenAI 兼容网关（如 Gemini）'],
      },
    );
    return;
  }

  const client = new Anthropic({
    apiKey: input.model.apiKey,
    baseURL: input.model.baseUrl,
  });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: input.model.model,
      max_tokens: input.model.extra?.max_tokens
        ? parseInt(input.model.extra.max_tokens, 10)
        : 8192,
      system: PM_SYSTEM_PROMPT,
      tools: [REQUEST_HUMAN_HELP_ANTHROPIC_TOOL],
      messages: [{ role: 'user', content: userContent }],
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await notifyPmFailure(
      api,
      input.loopId,
      loop.phase,
      `LLM 调用异常：${detail}`,
      members,
      { preferUserId: input.triggeredByUserId },
    );
    return;
  }

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
    await notifyPmFailure(
      api,
      input.loopId,
      loop.phase,
      '调用了未支持的工具，未生成 PRD',
      members,
      {
        preferUserId: input.triggeredByUserId,
        debug: summarizeAnthropicResponse(response),
      },
    );
    return;
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
    .join('\n')
    .trim();

  if (!text) {
    await notifyPmFailure(
      api,
      input.loopId,
      loop.phase,
      '模型响应为空（Anthropic SDK 无 text 块）',
      members,
      {
        preferUserId: input.triggeredByUserId,
        debug: summarizeAnthropicResponse(response),
      },
    );
    return;
  }

  if (input.isLoopEntry) {
    await api.postAgentMessage(
      input.loopId,
      { type: 'text', body: text },
      loop.phase,
    );
    return;
  }

  await finishPmSuccess(api, input.loopId, loop.phase, text);
}
