import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ResolvedModelConfig } from '@loop/shared';
import { mkdir } from 'node:fs/promises';
import { buildDevPrompt } from './prompts.js';
import { createDevHooks, DEV_SUBAGENTS } from './hooks.js';
import { OrchestratorApi } from './orchestrator-api.js';

export interface RunDevAgentInput {
  loopId: string;
  orchestratorUrl: string;
  model: ResolvedModelConfig;
  workspacePath: string;
  sandboxMode?: 'local' | 'docker';
  signal?: AbortSignal;
}

function mapSdkMessageToChat(
  message: { type: string; [key: string]: unknown },
): { body: string; type: 'text' | 'artifact'; sdkMessageType: string } | null {
  const type = message.type as string;

  if (type === 'assistant') {
    const msg = message.message as { content?: { type: string; text?: string }[] } | undefined;
    const blocks = msg?.content ?? (message.content as { type: string; text?: string }[]);
    if (Array.isArray(blocks)) {
      const text = blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      if (text) return { body: text, type: 'text', sdkMessageType: type };
    }
  }

  if (type === 'result') {
    const result = (message.result ?? message.subtype) as string | undefined;
    return {
      body: typeof result === 'string' ? result : '开发完成',
      type: 'text',
      sdkMessageType: type,
    };
  }

  const toolName = (message.name ?? message.tool_name ?? message.tool) as string | undefined;
  if (type === 'tool_use' || type === 'tool_progress' || toolName) {
    const input = message.input ?? message.tool_input;
    if (toolName === 'Read') {
      const path = (input as { file_path?: string })?.file_path ?? '';
      return { body: `正在读取 ${path}`, type: 'text', sdkMessageType: 'tool_use:Read' };
    }
    if (toolName === 'Edit' || toolName === 'Write') {
      const path = (input as { file_path?: string })?.file_path ?? '';
      return {
        body: `修改文件 ${path}`,
        type: 'artifact',
        sdkMessageType: `tool_use:${toolName}`,
      };
    }
    if (toolName === 'Bash') {
      const cmd = (input as { command?: string })?.command ?? '';
      return { body: `执行：${cmd}`, type: 'text', sdkMessageType: 'tool_use:Bash' };
    }
    return {
      body: `执行工具 ${toolName}: ${JSON.stringify(input ?? {})}`,
      type: 'text',
      sdkMessageType: type,
    };
  }

  return null;
}

export async function runDevAgent(input: RunDevAgentInput): Promise<void> {
  if (input.signal?.aborted) return;

  const api = new OrchestratorApi(input.orchestratorUrl);
  const loop = await api.getLoop(input.loopId);

  await mkdir(input.workspacePath, { recursive: true });

  const prompt = buildDevPrompt(loop.context, loop.title);
  let sessionId: string | undefined = loop.context.devSessionId;

  const env: Record<string, string> = { ...input.model.extra };
  if (input.model.apiKey) env.ANTHROPIC_API_KEY = input.model.apiKey;
  if (input.sandboxMode === 'docker') {
    env.SANDBOX_MODE = 'docker';
  }

  const hooks = createDevHooks({
    api,
    loopId: input.loopId,
    workspacePath: input.workspacePath,
  });

  for await (const message of query({
    prompt,
    options: {
      model: input.model.model,
      cwd: input.workspacePath,
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Agent'],
      permissionMode: 'acceptEdits',
      resume: sessionId,
      env,
      hooks,
      agents: DEV_SUBAGENTS,
    },
  })) {
    if (input.signal?.aborted) break;

    const mapped = mapSdkMessageToChat(
      message as { type: string; [key: string]: unknown },
    );
    if (mapped) {
      const actions =
        mapped.sdkMessageType === 'result'
          ? [{ id: 'approve-dev', label: '验收通过', action: 'approve_dev' as const }]
          : undefined;

      await api.postAgentMessage(
        input.loopId,
        { type: mapped.type, body: mapped.body, actions },
        loop.phase,
        mapped.sdkMessageType,
      );
    }

    const msg = message as { type: string; session_id?: string };
    if (msg.session_id) sessionId = msg.session_id;
  }

  if (sessionId && sessionId !== loop.context.devSessionId) {
    await api.updateContext(input.loopId, {
      ...loop.context,
      devSessionId: sessionId,
    });
  }
}
