import type { ResolvedModelConfig } from '@loop/shared';
import { access, mkdir } from 'node:fs/promises';
import { runDevAgentClaude } from './claude-agent.js';
import { runDevAgentOpenAI } from './openai-agent.js';
import { OrchestratorApi } from './orchestrator-api.js';

export interface RunDevAgentInput {
  loopId: string;
  orchestratorUrl: string;
  model: ResolvedModelConfig;
  workspacePath: string;
  memberRoster?: string;
  sandboxMode?: 'local' | 'docker';
  runId?: string;
  signal?: AbortSignal;
}

async function assertDevPrerequisites(
  workspacePath: string,
  model: ResolvedModelConfig,
): Promise<void> {
  if (!model.apiKey?.trim()) {
    throw new Error('DEV_MODEL_API_KEY 未配置或为空');
  }
  if (model.runtime === 'client-sdk' && !model.baseUrl?.trim()) {
    throw new Error('DEV_MODEL_BASE_URL 未配置（OpenAI 兼容模式必填）');
  }
  if (model.runtime === 'agent-sdk' && !model.model.toLowerCase().includes('claude')) {
    throw new Error(
      `agent-sdk 模式仅支持 Claude 模型，当前为 "${model.model}"。` +
        '请设置 DEV_AGENT_RUNTIME=client-sdk 以使用 OpenAI 兼容模型。',
    );
  }
  try {
    await access(workspacePath);
  } catch {
    throw new Error(`工作区不存在: ${workspacePath}`);
  }
}

export async function runDevAgent(input: RunDevAgentInput): Promise<void> {
  if (input.signal?.aborted) return;

  const api = new OrchestratorApi(input.orchestratorUrl, input.runId);
  const loop = await api.getLoop(input.loopId);

  await mkdir(input.workspacePath, { recursive: true });
  await assertDevPrerequisites(input.workspacePath, input.model);

  console.info(
    `[dev-agent] loop=${input.loopId} runtime=${input.model.runtime} model=${input.model.model} baseUrl=${input.model.baseUrl ?? '(none)'}`,
  );

  if (input.model.runtime === 'client-sdk') {
    await runDevAgentOpenAI({
      api,
      loopId: input.loopId,
      phase: loop.phase,
      title: loop.title,
      context: loop.context,
      workspacePath: input.workspacePath,
      memberRoster: input.memberRoster,
      model: input.model,
      signal: input.signal,
    });
    return;
  }

  const sessionId = await runDevAgentClaude({
    api,
    loopId: input.loopId,
    phase: loop.phase,
    loopContext: loop.context,
    loopTitle: loop.title,
    devSessionId: loop.context.devSessionId,
    workspacePath: input.workspacePath,
    model: input.model,
    sandboxMode: input.sandboxMode,
    signal: input.signal,
  });

  if (sessionId && sessionId !== loop.context.devSessionId) {
    await api.updateContext(input.loopId, {
      ...loop.context,
      devSessionId: sessionId,
    });
  }
}
