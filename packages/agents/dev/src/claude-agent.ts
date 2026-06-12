import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ResolvedModelConfig } from '@loop/shared';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { finishDevAgent } from './finish-dev.js';
import { buildDevPrompt } from './prompts.js';
import { createDevHooks, DEV_SUBAGENTS } from './hooks.js';
import type { OrchestratorApi } from './orchestrator-api.js';

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
      type: 'artifact',
      sdkMessageType: type,
    };
  }

  const toolName = (message.name ?? message.tool_name ?? message.tool) as string | undefined;
  if (type === 'tool_use' || type === 'tool_progress' || toolName) {
    const toolInput = message.input ?? message.tool_input;
    if (toolName === 'Read') {
      const path = (toolInput as { file_path?: string })?.file_path ?? '';
      return { body: `正在读取 ${path}`, type: 'text', sdkMessageType: 'tool_use:Read' };
    }
    if (toolName === 'Edit' || toolName === 'Write') {
      const path = (toolInput as { file_path?: string })?.file_path ?? '';
      return {
        body: `修改文件 ${path}`,
        type: 'artifact',
        sdkMessageType: `tool_use:${toolName}`,
      };
    }
    if (toolName === 'Bash') {
      const cmd = (toolInput as { command?: string })?.command ?? '';
      return { body: `执行：${cmd}`, type: 'text', sdkMessageType: 'tool_use:Bash' };
    }
    return {
      body: `执行工具 ${toolName}: ${JSON.stringify(toolInput ?? {})}`,
      type: 'text',
      sdkMessageType: type,
    };
  }

  return null;
}

function devPermissionMode(): 'acceptEdits' | 'default' {
  const override = process.env.DEV_PERMISSION_MODE?.trim();
  if (override === 'default' || override === 'acceptEdits') return override;
  if (process.env.KUBERNETES_SERVICE_HOST || process.env.SANDBOX_MODE === 'docker') {
    return 'default';
  }
  return 'acceptEdits';
}

export async function runDevAgentClaude(input: {
  api: OrchestratorApi;
  loopId: string;
  phase: string;
  loopContext: Parameters<typeof buildDevPrompt>[0];
  loopTitle: string;
  devSessionId?: string;
  workspacePath: string;
  model: ResolvedModelConfig;
  sandboxMode?: 'local' | 'docker';
  signal?: AbortSignal;
}): Promise<string | undefined> {
  const prompt = buildDevPrompt(input.loopContext, input.loopTitle);
  let sessionId: string | undefined = input.devSessionId;

  const env: Record<string, string> = {
    ...input.model.extra,
    SHELL: process.env.SHELL ?? '/bin/bash',
  };
  if (input.model.apiKey) env.ANTHROPIC_API_KEY = input.model.apiKey;
  if (input.sandboxMode === 'docker') {
    env.SANDBOX_MODE = 'docker';
  }

  const hooks = createDevHooks({
    api: input.api,
    loopId: input.loopId,
    workspacePath: input.workspacePath,
  });

  const debugEnabled = process.env.DEV_AGENT_DEBUG === 'true';
  const debugFile = debugEnabled
    ? join('/tmp', `claude-dev-${input.loopId}.log`)
    : undefined;

  let stream;
  try {
    stream = query({
      prompt,
      options: {
        model: input.model.model,
        cwd: input.workspacePath,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Agent'],
        permissionMode: devPermissionMode(),
        resume: sessionId,
        env,
        ...(debugEnabled ? { debug: true, debugFile } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hooks: hooks as any,
        agents: DEV_SUBAGENTS,
      },
    });
  } catch (err) {
    throw await enrichClaudeError(err, input.workspacePath, debugFile);
  }

  let toolsExecuted = 0;
  let finalText = '';
  let humanBlocked = false;

  try {
    for await (const message of stream) {
      if (input.signal?.aborted) break;

      const mapped = mapSdkMessageToChat(message as { type: string; [key: string]: unknown });
      if (mapped) {
        if (mapped.sdkMessageType.startsWith('tool_use:')) {
          toolsExecuted += 1;
        }
        if (mapped.sdkMessageType === 'result') {
          finalText = mapped.body;
          continue;
        }

        await input.api.postAgentMessage(
          input.loopId,
          { type: mapped.type, body: mapped.body },
          input.phase,
          mapped.sdkMessageType,
        );
      }

      const msg = message as { type: string; session_id?: string };
      if (msg.session_id) sessionId = msg.session_id;
    }
  } catch (err) {
    throw await enrichClaudeError(err, input.workspacePath, debugFile);
  }

  if (!input.signal?.aborted) {
    await finishDevAgent({
      api: input.api,
      loopId: input.loopId,
      phase: input.phase,
      finalText: finalText || '开发完成',
      humanBlocked,
      toolsExecuted,
    });
  }

  return sessionId;
}

async function enrichClaudeError(
  err: unknown,
  workspacePath: string,
  debugFile?: string,
): Promise<Error> {
  const base = err instanceof Error ? err.message : String(err);
  const lines = [
    base,
    `工作区: ${workspacePath}`,
    '当前为 agent-sdk（Claude Code）。若使用 Gemini/GPT，请设置 DEV_AGENT_RUNTIME=client-sdk 并重建镜像。',
    '常见原因: API Key 无效、缺少 bash、root 用户运行容器。',
  ];
  if (debugFile) {
    try {
      const tail = (await readFile(debugFile, 'utf-8')).trim().slice(-2000);
      if (tail) lines.push(`调试日志尾部:\n${tail}`);
    } catch {
      lines.push(`调试日志: ${debugFile}（文件不存在或为空）`);
    }
  }
  return new Error(lines.join('\n'));
}
