import { join } from 'node:path';
import { runDevAgent } from '@loop/agent-dev';
import { runOpsAgent } from '@loop/agent-ops';
import { runPmAgent } from '@loop/agent-pm';
import {
  resolveDevModel,
  resolveOpsModel,
  resolvePmModel,
} from './model-config.js';

export interface DispatchInput {
  loopId: string;
  runId: string;
  templateId: string;
  agentId: string;
  orchestratorUrl: string;
  startedBy?: string;
}

const abortControllers = new Map<string, AbortController>();

export async function dispatchRun(input: DispatchInput): Promise<void> {
  const key = `${input.loopId}:${input.runId}`;
  const existing = abortControllers.get(key);
  if (existing) existing.abort();

  const abort = new AbortController();
  abortControllers.set(key, abort);

  const loopRes = await fetch(`${input.orchestratorUrl}/api/loops/${input.loopId}`);
  if (!loopRes.ok) {
    throw new Error(`getLoop failed: ${loopRes.status}`);
  }
  const loop = (await loopRes.json()) as {
    title: string;
    workspace_path?: string;
    workspacePath?: string;
    phase?: string;
    context?: Record<string, unknown>;
  };

  const workspacePath =
    loop.workspace_path ??
    loop.workspacePath ??
    join(process.env.WORKSPACE_ROOT ?? './workspaces', `loop-${input.loopId}`);

  try {
    if (input.agentId === 'pm-agent') {
      await runPmAgent({
        loopId: input.loopId,
        runId: input.runId,
        orchestratorUrl: input.orchestratorUrl,
        model: resolvePmModel(),
        triggeredByUserId: input.startedBy,
        signal: abort.signal,
      });
      return;
    }

    if (input.agentId === 'dev-agent') {
      await runDevAgent({
        loopId: input.loopId,
        runId: input.runId,
        orchestratorUrl: input.orchestratorUrl,
        workspacePath,
        model: resolveDevModel(),
        signal: abort.signal,
      });
      return;
    }

    if (input.agentId === 'ops-agent') {
      await runOpsAgent({
        loopId: input.loopId,
        runId: input.runId,
        orchestratorUrl: input.orchestratorUrl,
        workspacePath,
        model: resolveOpsModel(),
        phase: (loop.phase as 'deployment') ?? 'deployment',
        signal: abort.signal,
      });
      return;
    }

    throw new Error(`Unknown agent: ${input.agentId}`);
  } finally {
    abortControllers.delete(key);
  }
}

export function cancelRun(loopId: string, runId: string): void {
  const key = `${loopId}:${runId}`;
  abortControllers.get(key)?.abort();
  abortControllers.delete(key);
}
