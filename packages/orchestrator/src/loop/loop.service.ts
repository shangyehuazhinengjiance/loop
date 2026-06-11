import type { LoopContext, ProjectModelConfig } from '@loop/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import { join } from 'node:path';
import type { LoopRow } from '../db/repositories/loop.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ProjectRepository } from '../db/repositories/project.repository.js';
import { ChatService } from '../chat/chat.service.js';
import { PhaseService } from '../phase/phase.service.js';
import { GitService } from '../git/git.service.js';
import { AgentCoordinator } from '../agent/agent-coordinator.js';
import { CodebaseSummaryService } from '../codebase/codebase-summary.service.js';
import { WorkspaceJobService } from '../workspace/workspace-job.service.js';
import { LoopMemberService } from '../member/loop-member.service.js';
import { InputRequirementsService } from '../requirements/input-requirements.service.js';
import { LoopProgressService } from '../chat/loop-progress.service.js';

@Injectable()
export class LoopService {
  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly chatService: ChatService,
    private readonly phaseService: PhaseService,
    private readonly gitService: GitService,
    private readonly agentCoordinator: AgentCoordinator,
    private readonly codebaseSummary: CodebaseSummaryService,
    private readonly workspaceJobs: WorkspaceJobService,
    private readonly memberService: LoopMemberService,
    private readonly inputRequirements: InputRequirementsService,
    private readonly progress: LoopProgressService,
  ) {}

  async createLoop(
    projectId: string,
    title: string,
    options?: {
      inputRequirements?: string;
      inputRequirementsTitle?: string;
    },
  ): Promise<LoopRow> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const workspaceRoot = process.env.WORKSPACE_ROOT ?? './workspaces';
    const loop = await this.loopRepo.create({ projectId, title });
    const workspacePath = join(workspaceRoot, `loop-${loop.id}`);
    await this.loopRepo.updateWorkspacePath(loop.id, workspacePath);

    const gitConfig = project.git_config as { remoteUrl?: string } | undefined;
    try {
      let initResult: Awaited<ReturnType<GitService['initLoopWorkspace']>>;
      if (gitConfig?.remoteUrl) {
        await this.progress.publish({
          loopId: loop.id,
          phase: loop.phase,
          label: '正在 clone 远程仓库并初始化工作区…',
          detail: `仓库：\`${gitConfig.remoteUrl}\``,
        });
        this.chatService.emitProcessing({
          loopId: loop.id,
          active: true,
          label: '正在初始化 Git 工作区…',
        });
        try {
          initResult = await this.gitService.initLoopWorkspace(loop.id);
        } finally {
          this.chatService.emitProcessing({ loopId: loop.id, active: false });
        }
        await this.progress.publish({
          loopId: loop.id,
          phase: loop.phase,
          label: 'Git 工作区已就绪',
          detail: `分支：\`loop/${loop.id}\``,
          updateBanner: false,
        });
      } else {
        initResult = await this.gitService.initLoopWorkspace(loop.id);
      }
      if (gitConfig?.remoteUrl) {
        await this.progress.publish({
          loopId: loop.id,
          phase: loop.phase,
          label: '正在生成代码库摘要（调用大模型）…',
          detail: '供 Dev Agent 快速理解项目结构，可能需要 1–2 分钟。',
        });
        const summary = await this.tryEnsureCodebaseSummary({
          projectId,
          loopId: loop.id,
          workspacePath,
          gitRef: initResult.gitRef,
          remoteUrl: gitConfig.remoteUrl,
          projectModelConfig: project.model_config,
        });
        if (summary) {
          await this.progress.publish({
            loopId: loop.id,
            phase: loop.phase,
            label: summary.cached
              ? '已复用项目代码库摘要'
              : '代码库摘要已生成',
            detail: `路径：\`${summary.path}\``,
            updateBanner: false,
          });
        }
        const summaryNote = summary
          ? summary.cached
            ? ` 已复用项目代码库摘要（${summary.path}）。`
            : ` 已生成代码库摘要（${summary.path}），Dev Agent 将优先阅读该文件。`
          : '';
        await this.chatService.publishAgentMessage({
          loopId: loop.id,
          phase: loop.phase,
          agentId: 'orchestrator',
          content: {
            type: 'text',
            body: `已从 ${gitConfig.remoteUrl} 初始化开发工作区，分支 loop/${loop.id}。${summaryNote}`,
          },
        });
      }
    } catch (err) {
      this.chatService.emitProcessing({ loopId: loop.id, active: false });
      const msg = err instanceof Error ? err.message : String(err);
      if (gitConfig?.remoteUrl) {
        console.error(`[loop] git init failed for ${loop.id}:`, err);
        await this.chatService.publishAgentMessage({
          loopId: loop.id,
          phase: loop.phase,
          agentId: 'orchestrator',
          content: {
            type: 'text',
            body: `Git 工作区初始化失败: ${msg}。请检查 Deploy Key / Token 与仓库地址，修复后调用 POST /api/loops/${loop.id}/reinit-workspace 重试。`,
          },
        });
      } else {
        console.warn(
          `[loop] 未配置 Git 远程仓库，工作区为空（仅本地 git）。` +
            ` 请配置 GIT_DEFAULT_REMOTE_URL 或 project.gitConfig.remoteUrl。`,
        );
      }
    }

    if (options?.inputRequirements?.trim()) {
      this.chatService.emitProcessing({
        loopId: loop.id,
        active: true,
        label: '正在保存导入的需求文档…',
      });
      try {
        await this.inputRequirements.ingestOnCreate({
          loopId: loop.id,
          loopTitle: title,
          content: options.inputRequirements,
          requirementsTitle: options.inputRequirementsTitle,
        });
      } finally {
        this.chatService.emitProcessing({ loopId: loop.id, active: false });
      }
    }

    return (await this.loopRepo.findById(loop.id))!;
  }

  reinitWorkspaceAsync(loopId: string) {
    return this.workspaceJobs.enqueueReinit(loopId);
  }

  async reinitWorkspace(loopId: string) {
    return this.workspaceJobs.executeReinitSync(loopId);
  }

  async updateProjectGitConfig(
    projectId: string,
    gitConfig: Record<string, unknown>,
  ) {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return this.projectRepo.updateGitConfig(projectId, gitConfig);
  }

  async getLoop(loopId: string): Promise<LoopRow | null> {
    return this.loopRepo.findById(loopId);
  }

  async listLoops(projectId: string): Promise<LoopRow[]> {
    return this.loopRepo.listByProject(projectId);
  }

  async startLoop(loopId: string): Promise<LoopRow> {
    await this.phaseService.start(loopId);
    return (await this.loopRepo.findById(loopId))!;
  }

  async handleHumanMessage(input: {
    loopId: string;
    userId: string;
    displayName: string;
    body: string;
    mentions?: string[];
  }) {
    const loop = await this.loopRepo.findById(input.loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${input.loopId}`);
    }

    await this.memberService.requireMember(input.loopId, input.userId);

    const mentions = [
      ...new Set([
        ...(input.mentions ?? []),
        ...this.extractMentions(input.body),
      ]),
    ];

    const humanMentions = mentions.filter((m) => /^@human-/i.test(m));
    if (humanMentions.length > 0) {
      const members = await this.memberService.list(input.loopId);
      const memberSet = new Set(members.map((m) => `@${m.userId}`));
      for (const hm of humanMentions) {
        if (!memberSet.has(hm)) {
          throw new BadRequestException(
            `只能 @ 已加入本 Loop 的成员：${hm}`,
          );
        }
      }
    }

    const message = await this.chatService.publishHumanMessage({
      loopId: input.loopId,
      phase: loop.phase,
      userId: input.userId,
      displayName: input.displayName,
      body: input.body,
      mentions,
    });

    if (loop.phase === 'created') {
      await this.phaseService.start(input.loopId);
    }

    for (const mention of mentions) {
      const agent = this.parseMention(mention);
      if (agent) {
        await this.agentCoordinator.activate(input.loopId, agent, {
          reason: 'mention',
          userId: input.userId,
        });
      }
    }

    return message;
  }

  async updateContext(loopId: string, context: LoopContext): Promise<LoopRow> {
    return this.loopRepo.updateContext(loopId, context);
  }

  async createProject(input: {
    name: string;
    gitConfig: Record<string, unknown>;
    modelConfig: ProjectModelConfig;
  }) {
    return this.projectRepo.create(input);
  }

  async getProject(projectId: string) {
    return this.projectRepo.findById(projectId);
  }

  async deleteLoop(loopId: string): Promise<void> {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }
    await this.loopRepo.delete(loopId);
  }

  async deleteProject(projectId: string): Promise<void> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const loops = await this.loopRepo.listByProject(projectId);
    for (const loop of loops) {
      await this.loopRepo.delete(loop.id);
    }
    await this.projectRepo.delete(projectId);
  }

  async listProjects() {
    return this.projectRepo.listAll();
  }

  async listProjectsWithLoops() {
    const projects = await this.projectRepo.listAll();
    return Promise.all(
      projects.map(async (project) => ({
        id: project.id,
        name: project.name,
        gitConfig: project.git_config,
        createdAt: project.created_at,
        loops: (await this.loopRepo.listByProject(project.id)).map((loop) => ({
          id: loop.id,
          title: loop.title,
          phase: loop.phase,
          status: loop.status,
          updatedAt: loop.updated_at,
        })),
      })),
    );
  }

  private extractMentions(body: string): string[] {
    const matches = body.match(/@[\w-]+/g) ?? [];
    return matches;
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

  private parseMention(mention: string): 'pm' | 'dev' | 'ops' | null {
    const m = mention.toLowerCase().replace('@', '');
    if (m === 'pm-agent' || m === 'pm') return 'pm';
    if (m === 'dev-agent' || m === 'dev') return 'dev';
    if (m === 'ops-agent' || m === 'ops') return 'ops';
    return null;
  }
}
