import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ResolvedModelConfig } from '@loop/shared';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
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

function wrapDevAgentStartError(
  err: unknown,
  ctx: { workspacePath: string; debugFile?: string },
): Error {
  const base = err instanceof Error ? err.message : String(err);
  const hints = [
    'Claude Agent SDK 子进程启动失败，常见原因：',
    '1) DEV_MODEL_API_KEY 无效或未配置',
    '2) 容器缺少 bash（镜像需安装 bash 并设置 SHELL=/bin/bash）',
    '3) 工作区路径无效或为空',
    '4) 以 root 运行容器（可尝试 securityContext.runAsUser）',
    ctx.debugFile ? `5) 查看调试日志: ${ctx.debugFile}` : '5) 设置 DEV_AGENT_DEBUG=true 获取详细日志',
  ];
  return new Error(`${base}\n工作区: ${ctx.workspacePath}\n${hints.join('\n')}`);
}

async function assertDevPrerequisites(
  workspacePath: string,
  model: ResolvedModelConfig,
): Promise<void> {
  if (!model.apiKey?.trim()) {
    throw new Error('DEV_MODEL_API_KEY 未配置或为空');
  }
  try {
    await access(workspacePath);
  } catch {
    throw new Error(`工作区不存在: ${workspacePath}`);
  }
}

function devPermissionMode(): 'acceptEdits' | 'default' {
  const override = process.env.DEV_PERMISSION_MODE?.trim();
  if (override === 'default' || override === 'acceptEdits') return override;
  // 容器内 acceptEdits 偶发失败，默认用 default（工具仍可通过 hooks 审批）
  if (process.env.KUBERNETES_SERVICE_HOST || process.env.SANDBOX_MODE === 'docker') {
    return 'default';
  }
  return 'acceptEdits';
}

export async function runDevAgent(input: RunDevAgentInput): Promise<void> {
  if (input.signal?.aborted) return;

  const api = new OrchestratorApi(input.orchestratorUrl);
  const loop = await api.getLoop(input.loopId);

  await mkdir(input.workspacePath, { recursive: true });
  await assertDevPrerequisites(input.workspacePath, input.model);

  const prompt = buildDevPrompt(loop.context, loop.title);
  let sessionId: string | undefined = loop.context.devSessionId;

  const env: Record<string, string> = {
    ...input.model.extra,
    SHELL: process.env.SHELL ?? '/bin/bash',
  };
  if (input.model.apiKey) env.ANTHROPIC_API_KEY = input.model.apiKey;
  if (input.sandboxMode === 'docker') {
    env.SANDBOX_MODE = 'docker';
  }

  const hooks = createDevHooks({
    api,
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
    throw wrapDevAgentStartError(err, { workspacePath: input.workspacePath, debugFile });
  }

  try {
    for await (const message of stream) {
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
  } catch (err) {
    throw wrapDevAgentStartError(err, { workspacePath: input.workspacePath, debugFile });
  }

  if (sessionId && sessionId !== loop.context.devSessionId) {
    await api.updateContext(input.loopId, {
      ...loop.context,
      devSessionId: sessionId,
    });
  }
}
