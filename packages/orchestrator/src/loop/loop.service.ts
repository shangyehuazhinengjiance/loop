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

    try {
      await this.gitService.initLoopWorkspace(loop.id);
    } catch (err) {
      console.warn(`[loop] git init skipped for ${loop.id}:`, err);
    }

    return (await this.loopRepo.findById(loop.id))!;
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
