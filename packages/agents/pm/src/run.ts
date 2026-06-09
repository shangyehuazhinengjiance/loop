import Anthropic from '@anthropic-ai/sdk';
import type { ResolvedModelConfig } from '@loop/shared';
import { buildPMUserPrompt, PM_SYSTEM_PROMPT } from './prompts.js';
import { OrchestratorApi, parsePrdAndTasks } from './orchestrator-api.js';

export interface RunPmAgentInput {
  loopId: string;
  orchestratorUrl: string;
  model: ResolvedModelConfig;
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

  const response = await client.messages.create({
    model: input.model.model,
    max_tokens: input.model.extra?.max_tokens
      ? parseInt(input.model.extra.max_tokens, 10)
      : 8192,
    system: PM_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: buildPMUserPrompt({
          requirement,
          existingPrd: loop.context.prd?.content,
          chatHistory: humanMessages,
        }),
      },
    ],
  });

  const text =
    response.content[0]?.type === 'text' ? response.content[0].text : '';
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
