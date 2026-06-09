import type { OrchestratorApi } from './orchestrator-api.js';

const BLOCKED_BASH = [/rm\s+-rf\s+\//, /mkfs/, /curl\s+.*\|\s*sh/];
const SENSITIVE_FILES = [/\.env$/, /id_rsa$/, /\.pem$/];

export function createDevHooks(input: {
  api: OrchestratorApi;
  loopId: string;
  workspacePath: string;
}) {
  return {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          async (ctx: { tool_input?: { command?: string } }) => {
            const cmd = ctx.tool_input?.command ?? '';
            for (const p of BLOCKED_BASH) {
              if (p.test(cmd)) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: `Blocked command: ${cmd}`,
                  },
                };
              }
            }
            await input.api.postAudit(input.loopId, {
              agent: 'dev-agent',
              action: 'bash',
              detail: { command: cmd },
            });
            return {};
          },
        ],
      },
      {
        matcher: 'Write|Edit',
        hooks: [
          async (ctx: { tool_input?: { file_path?: string } }) => {
            const path = ctx.tool_input?.file_path ?? '';
            if (!path.startsWith(input.workspacePath) && !path.includes('loop-')) {
              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                  permissionDecisionReason: 'Path outside workspace',
                },
              };
            }
            for (const p of SENSITIVE_FILES) {
              if (p.test(path)) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: 'Sensitive file blocked',
                  },
                };
              }
            }
            return {};
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: '.*',
        hooks: [
          async (ctx: { tool_name?: string; tool_input?: unknown }) => {
            await input.api.postAudit(input.loopId, {
              agent: 'dev-agent',
              action: `tool:${ctx.tool_name ?? 'unknown'}`,
              detail: { input: ctx.tool_input },
            });
            return {};
          },
        ],
      },
    ],
  };
}

export const DEV_SUBAGENTS = {
  'test-runner': {
    description: '运行测试并报告结果',
    prompt: '执行项目测试命令，报告通过/失败及错误信息',
    tools: ['Bash', 'Read'],
  },
  'code-reviewer': {
    description: '代码质量自检',
    prompt: '检查代码规范、安全问题和测试覆盖',
    tools: ['Read', 'Glob', 'Grep'],
  },
};
