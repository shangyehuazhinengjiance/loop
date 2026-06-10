import type { OrchestratorApi } from './orchestrator-api.js';
import { BLOCKED_BASH, SENSITIVE_FILES } from './security.js';

function bashCommand(input: unknown): string {
  const toolInput = (input as { tool_input?: { command?: string } }).tool_input;
  return toolInput?.command ?? '';
}

function filePath(input: unknown): string {
  const toolInput = (input as { tool_input?: { file_path?: string } }).tool_input;
  return toolInput?.file_path ?? '';
}

function toolMeta(input: unknown): { tool_name?: string; tool_input?: unknown } {
  return input as { tool_name?: string; tool_input?: unknown };
}

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
          async (hookInput: unknown) => {
            const cmd = bashCommand(hookInput);
            for (const p of BLOCKED_BASH) {
              if (p.test(cmd)) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'deny' as const,
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
          async (hookInput: unknown) => {
            const path = filePath(hookInput);
            if (!path.startsWith(input.workspacePath) && !path.includes('loop-')) {
              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse' as const,
                  permissionDecision: 'deny' as const,
                  permissionDecisionReason: 'Path outside workspace',
                },
              };
            }
            for (const p of SENSITIVE_FILES) {
              if (p.test(path)) {
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'deny' as const,
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
          async (hookInput: unknown) => {
            const { tool_name, tool_input } = toolMeta(hookInput);
            await input.api.postAudit(input.loopId, {
              agent: 'dev-agent',
              action: `tool:${tool_name ?? 'unknown'}`,
              detail: { input: tool_input },
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
