import { Module } from '@nestjs/common';
import { AgentController } from './agent/agent.controller.js';
import { AgentCoordinator } from './agent/agent-coordinator.js';
import { AgentRunnerService } from './agent/agent-runner.service.js';
import { ApprovalService } from './approval/approval.service.js';
import { ArtifactService } from './artifact/artifact.service.js';
import { AuditService } from './audit/audit.service.js';
import { ChatSseController } from './chat/chat.controller.js';
import { ChatService } from './chat/chat.service.js';
import { ApprovalRepository } from './db/repositories/approval.repository.js';
import { ArtifactRepository } from './db/repositories/artifact.repository.js';
import { AuditRepository } from './db/repositories/audit.repository.js';
import { LoopRepository } from './db/repositories/loop.repository.js';
import { MessageRepository } from './db/repositories/message.repository.js';
import { PhaseTransitionRepository } from './db/repositories/phase-transition.repository.js';
import { ProjectRepository } from './db/repositories/project.repository.js';
import { SnapshotRepository } from './db/repositories/snapshot.repository.js';
import { GitService } from './git/git.service.js';
import { SecretManager } from './git/secret-manager.js';
import { LoopController } from './loop/loop.controller.js';
import { LoopService } from './loop/loop.service.js';
import { ModelRouter } from './model/model-router.js';
import { PhaseService } from './phase/phase.service.js';
import { ReplayService } from './replay/replay.service.js';
import { SandboxService } from './sandbox/sandbox.service.js';
import { CodebaseSummaryService } from './codebase/codebase-summary.service.js';
import { WorkspaceJobService } from './workspace/workspace-job.service.js';
import { BlockerService } from './blocker/blocker.service.js';
import { LoopMemberService } from './member/loop-member.service.js';
import { LoopMemberRepository } from './db/repositories/loop-member.repository.js';

@Module({
  controllers: [LoopController, AgentController, ChatSseController],
  providers: [
    LoopRepository,
    ProjectRepository,
    MessageRepository,
    SnapshotRepository,
    PhaseTransitionRepository,
    ApprovalRepository,
    ArtifactRepository,
    AuditRepository,
    LoopService,
    PhaseService,
    ApprovalService,
    ChatService,
    AgentCoordinator,
    AgentRunnerService,
    ModelRouter,
    SecretManager,
    GitService,
    ArtifactService,
    AuditService,
    ReplayService,
    SandboxService,
    CodebaseSummaryService,
    WorkspaceJobService,
    LoopMemberRepository,
    LoopMemberService,
    BlockerService,
  ],
})
export class AppModule {}
