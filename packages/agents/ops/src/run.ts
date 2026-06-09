import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Phase, ResolvedModelConfig } from '@loop/shared';
import { buildOpsPrompt } from './prompts.js';
import { OrchestratorApi } from './orchestrator-api.js';

export interface RunOpsAgentInput {
  loopId: string;
  orchestratorUrl: string;
  model: ResolvedModelConfig;
  workspacePath: string;
  phase: Phase;
  signal?: AbortSignal;
}

function loadMcpServers(): Record<string, unknown> {
  const raw = process.env.OPS_MCP_SERVERS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function runOpsAgent(input: RunOpsAgentInput): Promise<void> {
  if (input.signal?.aborted) return;

  const api = new OrchestratorApi(input.orchestratorUrl);
  const loop = await api.getLoop(input.loopId);

  const prompt = buildOpsPrompt(loop.context, loop.title);
  let sessionId = loop.context.opsSessionId;

  const env: Record<string, string> = { ...input.model.extra };
  if (input.model.apiKey) env.ANTHROPIC_API_KEY = input.model.apiKey;

  const mcpServers = loadMcpServers();

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
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              async (ctx: { tool_input?: { command?: string } }) => {
                const cmd = ctx.tool_input?.command ?? '';
                if (/prod(uction)?/i.test(cmd) && !process.env.OPS_ALLOW_PROD) {
                  return {
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse',
                      permissionDecision: 'deny',
                      permissionDecisionReason: 'Production deploy requires Human approval',
                    },
                  };
                }
                await api.postAudit(input.loopId, 'bash', { command: cmd });
                return {};
              },
            ],
          },
        ],
      },
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
