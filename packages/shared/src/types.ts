/** Loop 生命周期阶段 */
export type Phase =
  | 'created'
  | 'requirement'
  | 'development'
  | 'deployment'
  | 'done';

export type LoopStatus = 'active' | 'blocked' | 'done' | 'archived';

export type BlockerKind = 'human_input' | 'human_fix' | 'human_decision' | 'external';

export type BlockerAgentId = 'pm-agent' | 'dev-agent' | 'ops-agent' | 'orchestrator';

/** Loop 阻塞：Agent 搞不定时等待某成员处理（不改变 phase） */
export interface LoopBlocker {
  kind: BlockerKind;
  phase: Phase;
  reason: string;
  question?: string;
  assigneeUserId: string;
  assigneeDisplayName: string;
  requestedBy: BlockerAgentId;
  createdAt: string;
  lastReminderAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

/** Loop 成员（per-Loop）；bio 为空表示「啥事都可以找」 */
export interface LoopMember {
  loopId: string;
  userId: string;
  displayName: string;
  bio: string;
  joinedAt: string;
}

export type ApprovalActionType =
  | 'approve_prd'
  | 'approve_dev'
  | 'approve_deploy'
  | 'rollback';

export type TransitionTrigger =
  | 'start'
  | 'approve_prd'
  | 'approve_dev'
  | 'approve_deploy'
  | 'rollback';

export type PhaseTransitionTrigger = TransitionTrigger | 'auto';

export interface Participant {
  type: 'human' | 'agent';
  id: string;
  displayName: string;
}

export interface PRDDocument {
  title: string;
  content: string;
  version: number;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'done';
  /** 任务负责人（Loop 成员 userId） */
  assigneeUserId?: string;
  assigneeDisplayName?: string;
}

export interface DeploymentInfo {
  stagingUrl?: string;
  productionUrl?: string;
  status: 'pending' | 'staging' | 'production' | 'failed';
  /** 部署推送目标分支（默认 test） */
  targetBranch?: string;
  commitSha?: string;
}

export interface LoopContext {
  prd?: PRDDocument;
  tasks?: Task[];
  gitRef?: string;
  devSessionId?: string;
  opsSessionId?: string;
  deployment?: DeploymentInfo;
}

export interface LoopGitConfig {
  remoteUrl: string;
  branch: string;
  defaultBranch: string;
  credentialRef: string;
}

export interface Loop {
  id: string;
  title: string;
  status: LoopStatus;
  phase: Phase;
  projectId: string;
  participants: Participant[];
  git: LoopGitConfig;
  workspacePath: string;
  context: LoopContext;
  modelOverrides?: Partial<ProjectModelConfig>;
  createdAt: string;
  updatedAt: string;
}

export interface LoopSnapshot {
  id: string;
  loopId: string;
  phase: Phase;
  label: string;
  createdAt: string;
  createdBy: string;
  prd?: PRDDocument;
  tasks?: Task[];
  gitRef: string;
  gitBranch: string;
  devSessionId?: string;
  messageWatermark: string;
}

export interface PhaseTransition {
  id: string;
  loopId: string;
  fromPhase: Phase | null;
  toPhase: Phase;
  trigger: PhaseTransitionTrigger;
  snapshotId?: string;
  createdAt: string;
}

export type ArtifactType = 'prd' | 'code_diff' | 'deploy_url' | 'test_report' | 'review_report';

export interface ArtifactRecord {
  id: string;
  loopId: string;
  phase: Phase;
  type: ArtifactType;
  name: string;
  version: number;
  content: Record<string, unknown>;
  diffFrom?: string;
  createdBy: string;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  loopId: string;
  agent?: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export type MessageContentType =
  | 'text'
  | 'artifact'
  | 'action'
  | 'mention'
  | 'phase_transition'
  | 'approval'
  | 'rollback';

export interface Action {
  id: string;
  label: string;
  action: ApprovalActionType;
  resolved?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface LoopMessage {
  id: string;
  loopId: string;
  phase: Phase;
  sender: {
    type: 'human' | 'agent' | 'system';
    id: string;
    displayName: string;
  };
  content: {
    type: MessageContentType;
    body: string;
    artifacts?: unknown[];
    mentions?: string[];
    actions?: Action[];
  };
  metadata: {
    timestamp: string;
    parentMessageId?: string;
    requiresHumanApproval?: boolean;
    sdkMessageType?: string;
  };
}

export interface ModelConfig {
  provider: 'anthropic' | 'openai-compatible' | 'bedrock' | 'vertex' | 'custom';
  baseUrl?: string;
  model: string;
  fastModel?: string;
  apiKeyRef: string;
  maxTokens?: number;
}

export interface ProjectModelConfig {
  pm: ModelConfig;
  dev: ModelConfig;
  ops: ModelConfig;
}

export interface ProjectConfig {
  id: string;
  name: string;
  git: {
    provider: 'github' | 'gitlab' | 'gitee' | 'custom';
    remoteUrl: string;
    credentialRef: string;
    defaultBranch: string;
  };
  models: ProjectModelConfig;
}

export interface ApprovalRecord {
  type: ApprovalActionType;
  loopId: string;
  phase: Phase;
  approvedBy: string;
  approvedAt: string;
  note?: string;
}

export interface ResolvedModelConfig {
  provider: string;
  baseUrl?: string;
  model: string;
  fastModel?: string;
  apiKey: string;
  runtime: 'client-sdk' | 'agent-sdk';
  extra?: Record<string, string>;
  litellm?: boolean;
}

export type AgentRole = 'pm' | 'dev' | 'ops';

export interface GitCredential {
  type: 'ssh' | 'token';
  sshKeyPath?: string;
  token?: string;
}

export interface ReplayResult {
  loopId: string;
  targetPhase: Phase;
  snapshotId?: string;
  messages: LoopMessage[];
  artifacts: ArtifactRecord[];
  phaseHistory: PhaseTransition[];
}
