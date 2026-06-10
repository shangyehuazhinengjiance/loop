import type { ApprovalActionType, LoopContext, LoopMessage, Phase } from '@loop/shared';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { WorkspaceJobService } from '../workspace/workspace-job.service.js';
import { BlockerService } from '../blocker/blocker.service.js';
import { LoopMemberService } from '../member/loop-member.service.js';
import type { BlockerAgentId, BlockerKind } from '@loop/shared';
import { ApprovalService } from '../approval/approval.service.js';
import { ArtifactService } from '../artifact/artifact.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ChatService } from '../chat/chat.service.js';
import { SnapshotRepository } from '../db/repositories/snapshot.repository.js';
import { ReplayService } from '../replay/replay.service.js';
import { mergeGitConfig, defaultGitConfigFromEnv } from '../git/default-git-config.js';
import { LoopService } from './loop.service.js';
import { PhaseService } from '../phase/phase.service.js';
import { AgentRunnerService } from '../agent/agent-runner.service.js';
import { CodebaseSummaryService } from '../codebase/codebase-summary.service.js';

@Controller('api')
export class LoopController {
  constructor(
    private readonly loopService: LoopService,
    private readonly phaseService: PhaseService,
    private readonly approvalService: ApprovalService,
    private readonly chatService: ChatService,
    private readonly snapshotRepo: SnapshotRepository,
    private readonly artifactService: ArtifactService,
    private readonly auditService: AuditService,
    private readonly replayService: ReplayService,
    private readonly workspaceJobs: WorkspaceJobService,
    private readonly memberService: LoopMemberService,
    private readonly blockerService: BlockerService,
    private readonly agentRunner: AgentRunnerService,
    private readonly codebaseSummary: CodebaseSummaryService,
  ) {}

  @Get('projects')
  async listProjects(@Query('withLoops') withLoops?: string) {
    if (withLoops === '1' || withLoops === 'true') {
      return this.loopService.listProjectsWithLoops();
    }
    return this.loopService.listProjects();
  }

  @Post('projects')
  async createProject(
    @Body() body: { name: string; gitConfig?: Record<string, unknown>; modelConfig?: unknown },
  ) {
    return this.loopService.createProject({
      name: body.name,
      gitConfig: mergeGitConfig(body.gitConfig, defaultGitConfigFromEnv()),
      modelConfig: (body.modelConfig as never) ?? {},
    });
  }

  @Get('projects/:id')
  async getProject(@Param('id') id: string) {
    const project = await this.loopService.getProject(id);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  @Patch('projects/:id')
  async updateProject(
    @Param('id') id: string,
    @Body() body: { gitConfig?: Record<string, unknown> },
  ) {
    if (!body.gitConfig) {
      throw new BadRequestException('gitConfig required');
    }
    const project = await this.loopService.updateProjectGitConfig(id, body.gitConfig);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  @Get('projects/:id/loops')
  async listLoops(@Param('id') projectId: string) {
    const project = await this.loopService.getProject(projectId);
    if (!project) throw new NotFoundException('Project not found');
    return this.loopService.listLoops(projectId);
  }

  @Post('projects/:id/loops')
  async createLoop(
    @Param('id') projectId: string,
    @Body() body: { title: string },
  ) {
    return this.loopService.createLoop(projectId, body.title);
  }

  @Get('loops/:id')
  async getLoop(@Param('id') id: string) {
    const loop = await this.loopService.getLoop(id);
    if (!loop) throw new NotFoundException('Loop not found');
    return {
      ...loop,
      processing: this.resolveLoopProcessing(id),
    };
  }

  private resolveLoopProcessing(loopId: string): {
    active: boolean;
    agent?: string;
    label?: string;
  } {
    const runningAgent = this.agentRunner.getRunningAgent(loopId);
    if (runningAgent) {
      const label =
        runningAgent === 'pm'
          ? 'PM Agent 正在处理…'
          : runningAgent === 'dev'
            ? 'Dev Agent 正在处理…'
            : 'Ops Agent 正在处理…';
      return { active: true, agent: runningAgent, label };
    }

    const workspaceLabel = this.workspaceJobs.getProcessingLabel(loopId);
    if (workspaceLabel) {
      return { active: true, label: workspaceLabel };
    }

    if (this.codebaseSummary.isGenerating(loopId)) {
      return { active: true, label: '正在生成代码库摘要…' };
    }

    return { active: false };
  }

  @Post('loops/:id/start')
  async startLoop(@Param('id') id: string) {
    return this.loopService.startLoop(id);
  }

  /** 默认异步（202），避免 clone + 摘要生成超时；?sync=true 保持旧行为 */
  @Post('loops/:id/reinit-workspace')
  async reinitWorkspace(
    @Param('id') id: string,
    @Query('sync') sync: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (sync === 'true' || sync === '1') {
      const result = await this.loopService.reinitWorkspace(id);
      return { sync: true, result };
    }
    const job = this.loopService.reinitWorkspaceAsync(id);
    res.status(202);
    return {
      accepted: true,
      job,
      pollUrl: `/api/loops/${id}/workspace-jobs/${job.id}`,
    };
  }

  @Get('loops/:id/workspace-jobs/latest')
  async latestWorkspaceJob(@Param('id') id: string) {
    const job = this.workspaceJobs.getLatestForLoop(id);
    if (!job) return { status: 'none' as const };
    return job;
  }

  @Get('loops/:id/workspace-jobs/:jobId')
  async getWorkspaceJob(@Param('id') loopId: string, @Param('jobId') jobId: string) {
    const job = this.workspaceJobs.getJob(jobId);
    if (!job || job.loopId !== loopId) {
      throw new NotFoundException('Workspace job not found');
    }
    return job;
  }

  @Get('loops/:id/members')
  async listMembers(@Param('id') id: string) {
    return this.memberService.list(id);
  }

  @Patch('loops/:id/members/me')
  async updateMyMember(
    @Param('id') id: string,
    @Body() body: { userId: string; displayName?: string; bio?: string },
  ) {
    if (!body.userId) throw new BadRequestException('userId required');
    const existing = await this.memberService.get(id, body.userId);
    if (!existing) throw new NotFoundException('Member not found');
    return this.memberService.join({
      loopId: id,
      userId: body.userId,
      displayName: body.displayName?.trim() || existing.displayName,
      bio: body.bio !== undefined ? body.bio : existing.bio,
    });
  }

  @Post('loops/:id/members/join')
  async joinLoop(
    @Param('id') id: string,
    @Body() body: { userId: string; displayName: string; bio?: string },
  ) {
    if (!body.userId || !body.displayName?.trim()) {
      throw new BadRequestException('userId and displayName required');
    }
    return this.memberService.join({
      loopId: id,
      userId: body.userId,
      displayName: body.displayName.trim(),
      bio: body.bio ?? '',
    });
  }

  @Post('loops/:id/blocker/resolve')
  async resolveBlocker(
    @Param('id') id: string,
    @Body() body: { userId: string; note?: string },
  ) {
    if (!body.userId) throw new BadRequestException('userId required');
    return this.blockerService.resolve({
      loopId: id,
      userId: body.userId,
      note: body.note,
    });
  }

  @Post('loops/:id/agent/blocker')
  async agentRequestBlocker(
    @Param('id') id: string,
    @Body()
    body: {
      requestedBy: BlockerAgentId;
      kind: BlockerKind;
      reason: string;
      question?: string;
      assigneeUserId?: string;
      skillsHint?: string;
    },
  ) {
    return this.blockerService.requestHumanHelp({
      loopId: id,
      requestedBy: body.requestedBy,
      kind: body.kind,
      reason: body.reason,
      question: body.question,
      assigneeUserId: body.assigneeUserId,
      skillsHint: body.skillsHint,
    });
  }

  @Post('loops/:id/rollback')
  async rollback(
    @Param('id') id: string,
    @Body() body: { targetPhase: Phase; reason: string; snapshotId?: string; userId?: string },
  ) {
    return this.phaseService.rollback(
      id,
      body.targetPhase,
      body.reason,
      body.userId ?? 'human',
      body.snapshotId,
    );
  }

  @Post('loops/:id/approve')
  async approve(
    @Param('id') id: string,
    @Body() body: { action: ApprovalActionType; approvedBy?: string; note?: string },
  ) {
    return this.approvalService.approve({
      loopId: id,
      action: body.action,
      approvedBy: body.approvedBy ?? 'human',
      note: body.note,
    });
  }

  @Get('loops/:id/snapshots')
  async listSnapshots(@Param('id') id: string) {
    const rows = await this.snapshotRepo.listByLoop(id);
    return rows.map((r) => this.snapshotRepo.toLoopSnapshot(r));
  }

  @Get('loops/:id/messages')
  async listMessages(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.chatService.listMessages(
      id,
      limit ? parseInt(limit, 10) : undefined,
      before,
    );
  }

  @Patch('loops/:id/context')
  async updateContext(
    @Param('id') id: string,
    @Body() body: { context: LoopContext },
  ) {
    return this.loopService.updateContext(id, body.context);
  }

  @Post('loops/:id/agent-messages')
  async postAgentMessage(
    @Param('id') id: string,
    @Body()
    body: {
      agentId: string;
      phase: string;
      content: LoopMessage['content'];
      sdkMessageType?: string;
    },
  ) {
    const loop = await this.loopService.getLoop(id);
    if (!loop) throw new NotFoundException('Loop not found');

    const message = await this.chatService.publishAgentMessage({
      loopId: id,
      phase: body.phase as Phase,
      agentId: body.agentId,
      content: body.content,
    });

    if (body.sdkMessageType) {
      message.metadata.sdkMessageType = body.sdkMessageType;
    }
    return message;
  }

  @Get('loops/:id/artifacts')
  async listArtifacts(@Param('id') id: string) {
    return this.artifactService.list(id);
  }

  @Get('loops/:id/artifacts/:artifactId/diff/:compareId')
  async artifactDiff(
    @Param('artifactId') artifactId: string,
    @Param('compareId') compareId: string,
  ) {
    return this.artifactService.getDiffBetweenVersions(artifactId, compareId);
  }

  @Get('loops/:id/audit')
  async listAudit(@Param('id') id: string) {
    return this.auditService.list(id);
  }

  @Post('loops/:id/audit')
  async postAudit(
    @Param('id') id: string,
    @Body() body: { agent?: string; action: string; detail?: Record<string, unknown> },
  ) {
    return this.auditService.log({ loopId: id, ...body });
  }

  @Get('loops/:id/replay')
  async replay(
    @Param('id') id: string,
    @Query('targetPhase') targetPhase?: Phase,
    @Query('snapshotId') snapshotId?: string,
  ) {
    return this.replayService.replay({ loopId: id, targetPhase, snapshotId });
  }

  @Get('loops/:id/approvals')
  async listApprovals(@Param('id') id: string) {
    return this.approvalService.list(id);
  }

  @Post('loops/:id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body()
    body: {
      userId?: string;
      displayName?: string;
      body: string;
      mentions?: string[];
    },
  ) {
    return this.loopService.handleHumanMessage({
      loopId: id,
      userId: body.userId ?? 'human',
      displayName: body.displayName ?? 'Human',
      body: body.body,
      mentions: body.mentions,
    });
  }
}
