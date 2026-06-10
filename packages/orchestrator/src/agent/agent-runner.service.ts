import { formatMemberRoster, type AgentRole, type Phase } from '@loop/shared';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { join } from 'node:path';
import { runDevAgent } from '@loop/agent-dev';
import { runOpsAgent } from '@loop/agent-ops';
import { runPmAgent } from '@loop/agent-pm';
import { ChatService } from '../chat/chat.service.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ProjectRepository } from '../db/repositories/project.repository.js';
import { ModelRouter } from '../model/model-router.js';
import { SandboxService } from '../sandbox/sandbox.service.js';
import { CodebaseSummaryService } from '../codebase/codebase-summary.service.js';
import { LoopMemberService } from '../member/loop-member.service.js';
import { AgentCoordinator, type AgentActivateEvent } from './agent-coordinator.js';
import type { LoopRow } from '../db/repositories/loop.repository.js';
import type { ProjectRow } from '../db/repositories/project.repository.js';

@Injectable()
export class AgentRunnerService implements OnModuleInit {
  private readonly running = new Set<string>();
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly coordinator: AgentCoordinator,
    private readonly loopRepo: LoopRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly modelRouter: ModelRouter,
    private readonly chatService: ChatService,
    private readonly sandbox: SandboxService,
    private readonly codebaseSummary: CodebaseSummaryService,
    private readonly memberService: LoopMemberService,
  ) {}

  onModuleInit() {
    this.coordinator.on('agent:activate', (event: AgentActivateEvent) => {
      void this.handleActivate(event);
    });

    this.coordinator.on('agent:cancel', (event: { loopId: string; agent: AgentRole }) => {
      const key = `${event.loopId}:${event.agent}`;
      this.abortControllers.get(key)?.abort();
    });
  }

  private async handleActivate(event: AgentActivateEvent): Promise<void> {
    const key = `${event.loopId}:${event.agent}`;
    if (this.running.has(key)) return;
    this.running.add(key);

    const abort = new AbortController();
    this.abortControllers.set(key, abort);

    try {
      const loop = await this.loopRepo.findById(event.loopId);
      if (loop?.status === 'blocked' && event.reason !== 'manual') {
        console.info(`[agent-runner] skip ${key}: loop is blocked`);
        return;
      }
      await this.runAgent(event.loopId, event.agent, loop?.phase ?? 'requirement', abort.signal);
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error(`[agent-runner] ${key} failed`, err);
      const loop = await this.loopRepo.findById(event.loopId);
      const detail =
        err instanceof Error ? err.message : String(err);
      const runtimeHint =
        event.agent === 'dev'
          ? '\n\n排查：在 Pod 执行 `echo $DEV_AGENT_RUNTIME`（应为 client-sdk）；`kubectl logs` 中应有 `runtime=client-sdk`。若仍是 agent-sdk，请重建 orchestrator 镜像并 rollout。'
          : '';
      await this.chatService.publishAgentMessage({
        loopId: event.loopId,
        phase: loop?.phase ?? 'requirement',
        agentId: `${event.agent}-agent`,
        content: {
          type: 'text',
          body: `Agent 执行失败: ${detail}${runtimeHint}`,
        },
      });
    } finally {
      this.running.delete(key);
      this.abortControllers.delete(key);
    }
  }

  private async runAgent(
    loopId: string,
    agent: AgentRole,
    phase: Phase,
    signal: AbortSignal,
  ): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) return;

    const project = await this.projectRepo.findById(loop.project_id);
    const model = this.modelRouter.resolveForLoop(
      project?.model_config,
      { modelOverrides: loop.model_overrides as never },
      agent,
    );

    const orchestratorUrl =
      process.env.ORCHESTRATOR_URL ??
      `http://localhost:${process.env.ORCHESTRATOR_PORT ?? 3000}`;

    const workspacePath =
      loop.workspace_path ??
      join(process.env.WORKSPACE_ROOT ?? './workspaces', `loop-${loopId}`);

    const members = await this.memberService.list(loopId);
    const memberRoster = formatMemberRoster(members);
    const common = { loopId, orchestratorUrl, model, signal, memberRoster };

    if (agent === 'pm') {
      await runPmAgent(common);
      return;
    }

    if (agent === 'dev') {
      if (!model.apiKey?.trim()) {
        throw new Error('DEV_MODEL_API_KEY 未配置，Dev Agent 无法启动');
      }
      await this.ensureCodebaseSummaryBeforeDev(loop, project, workspacePath, signal);
      if (signal.aborted) return;
      console.info(
        `[agent-runner] dev start loop=${loopId} runtime=${model.runtime} cwd=${workspacePath} model=${model.model}`,
      );
      await runDevAgent({
        ...common,
        workspacePath,
        sandboxMode: this.sandbox.isDockerMode() ? 'docker' : 'local',
      });
      return;
    }

    if (agent === 'ops') {
      await runOpsAgent({
        ...common,
        workspacePath,
        phase,
      });
    }
  }

  /** 初始化时未生成摘要则在 Dev 启动前补做（失败不阻断开发） */
  private async ensureCodebaseSummaryBeforeDev(
    loop: LoopRow,
    project: ProjectRow | null,
    workspacePath: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted || !this.codebaseSummary.isEnabled()) return;

    if (await this.codebaseSummary.hasSummary(workspacePath)) {
      return;
    }

    const gitConfig = project?.git_config as { remoteUrl?: string } | undefined;
    if (!gitConfig?.remoteUrl) return;

    await this.chatService.publishAgentMessage({
      loopId: loop.id,
      phase: loop.phase,
      agentId: 'orchestrator',
      content: {
        type: 'text',
        body: '代码库摘要缺失，Dev Agent 启动前正在生成（约 1–2 分钟）…',
      },
    });

    try {
      const result = await this.codebaseSummary.ensureForLoop({
        projectId: loop.project_id,
        loopId: loop.id,
        workspacePath,
        gitRef: loop.context.gitRef,
        remoteUrl: gitConfig.remoteUrl,
        projectModelConfig: project?.model_config,
      });
      if (signal.aborted) return;

      const note = result
        ? result.cached
          ? `已复用项目缓存，写入 ${result.path}。`
          : `已生成 ${result.path}。`
        : '工作区暂无可扫描内容，跳过摘要。';
      await this.chatService.publishAgentMessage({
        loopId: loop.id,
        phase: loop.phase,
        agentId: 'orchestrator',
        content: { type: 'text', body: `代码库摘要就绪：${note}` },
      });
    } catch (err) {
      console.warn(`[agent-runner] pre-dev summary failed for ${loop.id}:`, err);
      const msg = err instanceof Error ? err.message : String(err);
      await this.chatService.publishAgentMessage({
        loopId: loop.id,
        phase: loop.phase,
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: `代码库摘要生成失败（${msg}），Dev Agent 将直接探索代码库。`,
        },
      });
    }
  }
}
