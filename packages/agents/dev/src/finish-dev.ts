import type { OrchestratorApi } from './orchestrator-api.js';

export interface GitCommitResult {
  commitSha: string;
  hadChanges: boolean;
  pushed?: boolean;
  branch?: string;
}

export interface FinishDevInput {
  api: OrchestratorApi;
  loopId: string;
  phase: string;
  finalText: string;
  humanBlocked?: boolean;
  toolsExecuted?: number;
}

function isDevRun(loop: {
  phase: string;
  activeTemplateId?: string;
}): boolean {
  return loop.phase === 'development' || loop.activeTemplateId === 'dev-impl';
}

function appendGitNote(body: string, commit: GitCommitResult | null, error?: string): string {
  if (error) {
    return `${body}\n\n⚠️ 代码未能自动提交：${error}`;
  }
  if (!commit) return body;
  if (commit.hadChanges) {
    const short = commit.commitSha.slice(0, 7);
    const pushNote = commit.pushed ? '，已推送到远程' : '';
    return `${body}\n\n✅ 代码已提交到仓库（\`${short}\`${pushNote}，分支 \`${commit.branch ?? 'loop'}\`）`;
  }
  return `${body}\n\n（工作区无未提交改动）`;
}

export async function finishDevAgent(input: FinishDevInput): Promise<void> {
  const {
    api,
    loopId,
    phase,
    finalText,
    humanBlocked = false,
    toolsExecuted = 0,
  } = input;

  let commit: GitCommitResult | null = null;
  let commitError: string | undefined;

  if (!humanBlocked && toolsExecuted > 0) {
    await api.reportProgress(loopId, phase, {
      label: '正在提交代码到仓库…',
      updateBanner: false,
    });
    try {
      commit = await api.commitDevWorkspace(loopId);
    } catch (err) {
      commitError = err instanceof Error ? err.message : String(err);
      console.warn(`commitDevWorkspace failed: ${commitError}`);
    }
  }

  const loop = await api.getLoop(loopId);
  const devRun = isDevRun(loop);
  const canApprove = !humanBlocked && toolsExecuted > 0 && devRun;
  const body = appendGitNote(
    finalText ||
      (toolsExecuted > 0 ? '开发完成' : '开发未完成：模型未实际调用工具。请重试 @dev-agent。'),
    commit,
    commitError,
  );

  await api.postAgentMessage(
    loopId,
    {
      type: canApprove ? 'artifact' : 'text',
      body: devRun
        ? body
        : `${body}\n\n（当前 Loop 处于 \`${loop.phase}\` 阶段，无需开发验收。）`,
      actions: canApprove
        ? [{ id: 'approve-dev', label: '验收通过', action: 'approve_dev' }]
        : undefined,
    },
    loop.phase,
    humanBlocked ? 'blocked' : canApprove ? 'result' : 'incomplete',
  );

  await api.reportProgress(loopId, phase, {
    label: '开发任务已完成，请验收',
    active: false,
    updateBanner: false,
  });
}
