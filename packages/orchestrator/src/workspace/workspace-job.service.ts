import type { ProjectModelConfig } from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { InitWorkspaceResult } from '../git/git.service.js';
import { GitService } from '../git/git.service.js';
import { ChatService } from '../chat/chat.service.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ProjectRepository } from '../db/repositories/project.repository.js';
import { CodebaseSummaryService } from '../codebase/codebase-summary.service.js';

export type WorkspaceJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type WorkspaceJobStep = 'git_clone' | 'codebase_summary' | 'done';

export interface WorkspaceJobResult extends InitWorkspaceResult {
  summaryPath?: string;
  summaryCached?: boolean;
}

export interface WorkspaceJob {
  id: string;
  loopId: string;
  type: 'reinit';
  status: WorkspaceJobStatus;
  step?: WorkspaceJobStep;
  error?: string;
  result?: WorkspaceJobResult;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class WorkspaceJobService {
  private readonly jobs = new Map<string, WorkspaceJob>();
  private readonly activeByLoop = new Map<string, string>();

  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly gitService: GitService,
    private readonly chatService: ChatService,
    private readonly codebaseSummary: CodebaseSummaryService,
  ) {}

  getJob(jobId: string): WorkspaceJob | undefined {
    return this.jobs.get(jobId);
  }

  getLatestForLoop(loopId: string): WorkspaceJob | undefined {
    let latest: WorkspaceJob | undefined;
    for (const job of this.jobs.values()) {
      if (job.loopId !== loopId) continue;
      if (!latest || job.createdAt > latest.createdAt) latest = job;
    }
    return latest;
  }

  /** 异步入队，立即返回 job（默认模式，避免 HTTP 超时） */
  enqueueReinit(loopId: string): WorkspaceJob {
    const activeId = this.activeByLoop.get(loopId);
    if (activeId) {
      const existing = this.jobs.get(activeId);
      if (existing && (existing.status === 'pending' || existing.status === 'running')) {
        return existing;
      }
    }

    const now = new Date().toISOString();
    const job: WorkspaceJob = {
      id: randomUUID(),
      loopId,
      type: 'reinit',
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(job.id, job);
    this.activeByLoop.set(loopId, job.id);
    void this.runReinitJob(job.id);
    return job;
  }

  /** 同步执行（?sync=true） */
  async executeReinitSync(loopId: string): Promise<WorkspaceJobResult> {
    return this.doReinit(loopId, { progressInChat: true });
  }

  private patchJob(jobId: string, patch: Partial<WorkspaceJob>): WorkspaceJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
    this.jobs.set(jobId, next);
    return next;
  }

  private async runReinitJob(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) return;

    this.patchJob(jobId, { status: 'running', step: 'git_clone' });

    try {
      const result = await this.doReinit(job.loopId, { progressInChat: true, jobId });
      this.patchJob(jobId, { status: 'succeeded', step: 'done', result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.patchJob(jobId, { status: 'failed', error: message });
      const loop = await this.loopRepo.findById(job.loopId);
      await this.chatService.publishAgentMessage({
        loopId: job.loopId,
        phase: loop?.phase ?? 'created',
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: `工作区重新初始化失败: ${message}`,
        },
      });
    } finally {
      this.activeByLoop.delete(job.loopId);
    }
  }

  private async doReinit(
    loopId: string,
    opts: { progressInChat: boolean; jobId?: string },
  ): Promise<WorkspaceJobResult> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) throw new Error(`Loop not found: ${loopId}`);

    const project = await this.projectRepo.findById(loop.project_id);
    const gitConfig = project?.git_config as { remoteUrl?: string } | undefined;
    if (!gitConfig?.remoteUrl) {
      throw new Error(
        'Project 未配置 gitConfig.remoteUrl。请先 PATCH /api/projects/:id 或设置 GIT_DEFAULT_REMOTE_URL。',
      );
    }

    if (opts.progressInChat) {
      await this.chatService.publishAgentMessage({
        loopId,
        phase: loop.phase,
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: '正在后台重新初始化工作区：拉取 Git 仓库…',
        },
      });
    }

    const gitResult = await this.gitService.reinitLoopWorkspace(loopId);

    if (opts.jobId) {
      this.patchJob(opts.jobId, { step: 'codebase_summary' });
    }
    if (opts.progressInChat) {
      await this.chatService.publishAgentMessage({
        loopId,
        phase: loop.phase,
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: 'Git 拉取完成，正在生成代码库摘要（可能需要 1–2 分钟）…',
        },
      });
    }

    const summary = await this.tryEnsureCodebaseSummary({
      projectId: loop.project_id,
      loopId,
      workspacePath: gitResult.workspacePath,
      gitRef: gitResult.gitRef,
      remoteUrl: gitConfig.remoteUrl,
      projectModelConfig: project?.model_config,
    });

    const summaryNote = summary
      ? summary.cached
        ? ` 已复用项目代码库摘要（${summary.path}）。`
        : ` 已重新生成代码库摘要（${summary.path}）。`
      : '';

    if (opts.progressInChat) {
      await this.chatService.publishAgentMessage({
        loopId,
        phase: loop.phase,
        agentId: 'orchestrator',
        content: {
          type: 'text',
          body: `工作区已重新从 ${gitConfig.remoteUrl} 拉取，当前分支 ${gitResult.gitBranch}。${summaryNote}`,
        },
      });
    }

    return {
      ...gitResult,
      summaryPath: summary?.path,
      summaryCached: summary?.cached,
    };
  }

  private async tryEnsureCodebaseSummary(input: {
    projectId: string;
    loopId: string;
    workspacePath: string;
    gitRef?: string;
    remoteUrl?: string;
    projectModelConfig?: ProjectModelConfig;
  }) {
    try {
      return await this.codebaseSummary.ensureForLoop(input);
    } catch (err) {
      console.warn(`[codebase-summary] failed for loop ${input.loopId}:`, err);
      return null;
    }
  }
}
