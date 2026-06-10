import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { Phase, ResolvedModelConfig } from '@loop/shared';
import { runOpsAgentOpenAI } from './openai-agent.js';
import { buildOpsPrompt } from './prompts.js';
import { OrchestratorApi } from './orchestrator-api.js';

export interface RunOpsAgentInput {
  loopId: string;
  orchestratorUrl: string;
  model: ResolvedModelConfig;
  workspacePath: string;
  phase: Phase;
  memberRoster?: string;
  signal?: AbortSignal;
}

function loadMcpServers(): NonNullable<Options['mcpServers']> {
  const raw = process.env.OPS_MCP_SERVERS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as NonNullable<Options['mcpServers']>;
  } catch {
    return {};
  }
}

export async function runOpsAgent(input: RunOpsAgentInput): Promise<void> {
  if (input.signal?.aborted) return;

  const api = new OrchestratorApi(input.orchestratorUrl);
  const loop = await api.getLoop(input.loopId);

  if (input.model.runtime === 'client-sdk') {
    if (!input.model.apiKey?.trim()) {
      throw new Error('OPS_MODEL_API_KEY 未配置');
    }
    if (!input.model.baseUrl?.trim()) {
      throw new Error('OPS_MODEL_BASE_URL 未配置（client-sdk 模式必填）');
    }
    console.info(
      `[ops-agent] loop=${input.loopId} runtime=client-sdk model=${input.model.model}`,
    );
    await runOpsAgentOpenAI({
      api,
      loopId: input.loopId,
      phase: input.phase,
      title: loop.title,
      context: loop.context,
      workspacePath: input.workspacePath,
      memberRoster: input.memberRoster,
      model: input.model,
      signal: input.signal,
    });
    return;
  }

  if (!input.model.model.toLowerCase().includes('claude')) {
    throw new Error(
      `agent-sdk 模式仅支持 Claude 模型，当前为 "${input.model.model}"。` +
        '请设置 OPS_AGENT_RUNTIME=client-sdk。',
    );
  }

  const prompt = buildOpsPrompt(loop.context, loop.title, input.memberRoster);
  let sessionId = loop.context.opsSessionId;

  const env: Record<string, string> = { ...input.model.extra };
  if (input.model.apiKey) env.ANTHROPIC_API_KEY = input.model.apiKey;

  const mcpServers = loadMcpServers();

  const opsHooks = {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          async (hookInput: unknown) => {
            const cmd =
              (hookInput as { tool_input?: { command?: string } }).tool_input
                ?.command ?? '';
            if (/prod(uction)?/i.test(cmd) && !process.env.OPS_ALLOW_PROD) {
              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse' as const,
                  permissionDecision: 'deny' as const,
                  permissionDecisionReason:
                    'Production deploy requires Human approval',
                },
              };
            }
            await api.postAudit(input.loopId, 'bash', { command: cmd });
            return {};
          },
        ],
      },
    ],
  };

  for await (const message of query({
    prompt,
    options: {
      model: input.model.model,
      cwd: input.workspacePath,
      allowedTools: ['Read', 'Bash', 'Glob', 'Grep'],
      permissionMode: 'default',
      resume: sessionId,
      env,
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hooks: opsHooks as any,
    },
  })) {
    if (input.signal?.aborted) break;

    const msg = message as {
      type: string;
      result?: string;
      session_id?: string;
      message?: { content?: { type: string; text?: string }[] };
    };

    if (msg.type === 'result' || msg.type === 'assistant') {
      const text =
        msg.result ??
        msg.message?.content
          ?.filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('') ??
        '';

      if (text) {
        const stagingMatch = text.match(/https?:\/\/[^\s]+/);
        const deployment = {
          ...loop.context.deployment,
          stagingUrl: stagingMatch?.[0] ?? loop.context.deployment?.stagingUrl,
          status: 'staging' as const,
        };

        await api.updateContext(input.loopId, {
          ...loop.context,
          deployment,
          opsSessionId: sessionId,
        });

        await api.postAgentMessage(
          input.loopId,
          {
            type: 'artifact',
            body: text,
            actions: [
              { id: 'approve-deploy', label: '确认发布', action: 'approve_deploy' },
            ],
          },
          input.phase,
        );
      }
    }

    if (msg.session_id) sessionId = msg.session_id;
  }

  if (sessionId && sessionId !== loop.context.opsSessionId) {
    await api.updateContext(input.loopId, {
      ...loop.context,
      opsSessionId: sessionId,
    });
  }
}
