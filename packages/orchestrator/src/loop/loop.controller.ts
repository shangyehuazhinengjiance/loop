import type { ApprovalActionType, LoopContext, LoopMessage, Phase } from '@loop/shared';
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApprovalService } from '../approval/approval.service.js';
import { ArtifactService } from '../artifact/artifact.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ChatService } from '../chat/chat.service.js';
import { SnapshotRepository } from '../db/repositories/snapshot.repository.js';
import { ReplayService } from '../replay/replay.service.js';
import { LoopService } from './loop.service.js';
import { PhaseService } from '../phase/phase.service.js';

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
  ) {}

  @Post('projects')
  async createProject(
    @Body() body: { name: string; gitConfig?: Record<string, unknown>; modelConfig?: unknown },
  ) {
    return this.loopService.createProject({
      name: body.name,
      gitConfig: body.gitConfig ?? {},
      modelConfig: (body.modelConfig as never) ?? {},
    });
  }

  @Get('projects/:id')
  async getProject(@Param('id') id: string) {
    const project = await this.loopService.getProject(id);
    if (!project) throw new NotFoundException('Project not found');
    return project;
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
    return loop;
  }

  @Post('loops/:id/start')
  async startLoop(@Param('id') id: string) {
    return this.loopService.startLoop(id);
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
