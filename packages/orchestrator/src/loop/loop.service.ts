import type { LoopContext, ProjectModelConfig } from '@loop/shared';
import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import type { LoopRow } from '../db/repositories/loop.repository.js';
import { LoopRepository } from '../db/repositories/loop.repository.js';
import { ProjectRepository } from '../db/repositories/project.repository.js';
import { ChatService } from '../chat/chat.service.js';
import { PhaseService } from '../phase/phase.service.js';
import { GitService } from '../git/git.service.js';
import { AgentCoordinator } from '../agent/agent-coordinator.js';

@Injectable()
export class LoopService {
  constructor(
    private readonly loopRepo: LoopRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly chatService: ChatService,
    private readonly phaseService: PhaseService,
    private readonly gitService: GitService,
    private readonly agentCoordinator: AgentCoordinator,
  ) {}

  async createLoop(projectId: string, title: string): Promise<LoopRow> {
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
      await this.gitService.initLoopWorkspace(loop.id);
      if (gitConfig?.remoteUrl) {
        await this.chatService.publishAgentMessage({
          loopId: loop.id,
          phase: loop.phase,
          agentId: 'orchestrator',
          content: {
            type: 'text',
            body: `已从 ${gitConfig.remoteUrl} 初始化开发工作区，分支 loop/${loop.id}。`,
          },
        });
      }
    } catch (err) {
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

    return (await this.loopRepo.findById(loop.id))!;
  }

  async reinitWorkspace(loopId: string) {
    const loop = await this.loopRepo.findById(loopId);
    if (!loop) throw new Error(`Loop not found: ${loopId}`);

    const project = await this.projectRepo.findById(loop.project_id);
    const gitConfig = project?.git_config as { remoteUrl?: string } | undefined;
    if (!gitConfig?.remoteUrl) {
      throw new Error(
        'Project 未配置 gitConfig.remoteUrl。请先 PATCH /api/projects/:id 或设置 GIT_DEFAULT_REMOTE_URL。',
      );
    }

    const result = await this.gitService.reinitLoopWorkspace(loopId);
    await this.chatService.publishAgentMessage({
      loopId,
      phase: loop.phase,
      agentId: 'orchestrator',
      content: {
        type: 'text',
        body: `工作区已重新从 ${gitConfig.remoteUrl} 拉取，当前分支 ${result.gitBranch}。`,
      },
    });
    return result;
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

    const mentions = [
      ...new Set([
        ...(input.mentions ?? []),
        ...this.extractMentions(input.body),
      ]),
    ];

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

  private parseMention(mention: string): 'pm' | 'dev' | 'ops' | null {
    const m = mention.toLowerCase().replace('@', '');
    if (m === 'pm-agent' || m === 'pm') return 'pm';
    if (m === 'dev-agent' || m === 'dev') return 'dev';
    if (m === 'ops-agent' || m === 'ops') return 'ops';
    return null;
  }
}
