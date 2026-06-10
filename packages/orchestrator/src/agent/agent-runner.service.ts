import type { AgentRole, Phase } from '@loop/shared';
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
import { AgentCoordinator, type AgentActivateEvent } from './agent-coordinator.js';

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
      await this.runAgent(event.loopId, event.agent, loop?.phase ?? 'requirement', abort.signal);
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error(`[agent-runner] ${key} failed`, err);
      const loop = await this.loopRepo.findById(event.loopId);
      await this.chatService.publishAgentMessage({
        loopId: event.loopId,
        phase: loop?.phase ?? 'requirement',
        agentId: `${event.agent}-agent`,
        content: {
          type: 'text',
          body: `Agent 执行失败: ${err instanceof Error ? err.message : String(err)}`,
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

    const common = { loopId, orchestratorUrl, model, signal };

    if (agent === 'pm') {
      await runPmAgent(common);
      return;
    }

    if (agent === 'dev') {
      if (!model.apiKey?.trim()) {
        throw new Error('DEV_MODEL_API_KEY 未配置，Dev Agent 无法启动');
      }
      console.info(
        `[agent-runner] dev start loop=${loopId} cwd=${workspacePath} model=${model.model}`,
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
}
