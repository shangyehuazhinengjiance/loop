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
  /** development 阶段 PM 增量更新 PRD 后的重确认（不触发阶段流转） */
  | 'confirm_prd_revision'
  | 'approve_dev'
  | 'confirm_mr_merged'
  | 'confirm_master_mr_merged'
  | 'approve_test'
  | 'reject_test'
  | 'approve_deploy'
  | 'rollback';

/** 群聊内交互按钮（含审批与开发模式选择） */
export type LoopInteractiveAction =
  | ApprovalActionType
  | 'select_dev_mode_agent'
  | 'select_dev_mode_external'
  | 'complete_external_dev';

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

/** manual：人合并/部署；agent：Ops Agent 自动部署 */
export type DeploymentExecutionMode = 'manual' | 'agent';

export type DeploymentStep =
  | 'awaiting_mr_merge'
  /** @deprecated 旧流程，等同 awaiting_test_approval */
  | 'awaiting_pipeline'
  /** agent 模式：Ops 部署测试环境 */
  | 'awaiting_test_deploy'
  | 'awaiting_test_approval'
  | 'awaiting_prod_deploy'
  | 'awaiting_prod_approval'
  /** manual 模式：等人部署并验证测试环境 */
  | 'awaiting_manual_test_deploy'
  /** manual 模式：等人合并 test → master MR */
  | 'awaiting_master_mr_merge'
  /** manual 模式：等人验证生产环境 */
  | 'awaiting_manual_prod_verify';

export type OpsDeployTarget = 'test' | 'production';

export interface MergeRequestInfo {
  url: string;
  number: number;
  headBranch: string;
  baseBranch: string;
  provider: 'github' | 'gitlab';
  createdAt: string;
}

export interface DeploymentInfo {
  stagingUrl?: string;
  productionUrl?: string;
  status: 'pending' | 'staging' | 'production' | 'failed';
  /** manual | agent，进入 deployment 时从项目配置写入 */
  executionMode?: DeploymentExecutionMode;
  /** 部署目标分支（默认 test） */
  targetBranch?: string;
  productionBranch?: string;
  commitSha?: string;
  /** deployment 子步骤 */
  step?: DeploymentStep;
  /** loop → test */
  mergeRequest?: MergeRequestInfo;
  mergeAssigneeUserId?: string;
  mergeAssigneeDisplayName?: string;
  mrMergedAt?: string;
  mrMergedBy?: string;
  /** manual：测试环境部署/验证负责人 */
  deployAssigneeUserId?: string;
  deployAssigneeDisplayName?: string;
  /** test → master */
  masterMergeRequest?: MergeRequestInfo;
  masterMergeAssigneeUserId?: string;
  masterMergeAssigneeDisplayName?: string;
  masterMrMergedAt?: string;
  masterMrMergedBy?: string;
  testDeployedAt?: string;
  testApprovedAt?: string;
  testApprovedBy?: string;
  testRejectedAt?: string;
  testRejectedBy?: string;
  testApproverUserId?: string;
  testApproverDisplayName?: string;
  prodDeployedAt?: string;
  prodApprovedAt?: string;
  prodApprovedBy?: string;
}

export type DevelopmentMode = 'agent' | 'external';

export interface ExternalDevelopmentInfo {
  assigneeUserId: string;
  assigneeDisplayName: string;
  prdCommitSha?: string;
  prdPushedAt?: string;
  handoffAt?: string;
  completedAt?: string;
  completedBy?: string;
  targetBranch: string;
}

/** 创建 Loop 时由产品同学粘贴的外部需求（PM 首轮先熟悉，再整理为正式 PRD） */
export interface InputRequirementsDocument {
  title: string;
  content: string;
  source: 'create_form';
  savedAt: string;
  /** 工作区内相对路径，如 docs/loop/{id}/INPUT_REQUIREMENTS.md */
  gitPath: string;
  commitSha?: string;
}

/** development 阶段子状态（顶层 phase 仍为 development） */
export interface DevelopmentConfig {
  /** 未设置 = 等待 PRD 确认人选择开发模式 */
  mode?: DevelopmentMode;
  /** 确认 PRD 的成员 userId，仅此用户可选择开发模式 */
  prdApprovedBy?: string;
  external?: ExternalDevelopmentInfo;
}

export interface LoopContext {
  prd?: PRDDocument;
  tasks?: Task[];
  gitRef?: string;
  devSessionId?: string;
  opsSessionId?: string;
  deployment?: DeploymentInfo;
  development?: DevelopmentConfig;
  /** 动态协作：被挂起等待恢复的 Agent */
  agentRouting?: AgentRoutingState;
  /** 创建时导入的外部需求文档（已写入 Git 工作区） */
  inputRequirements?: InputRequirementsDocument;
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
  | 'rollback'
  /** 流程步骤进度（需求阶段 PM 总结、Git 推送等） */
  | 'progress';

export interface Action {
  id: string;
  label: string;
  action: LoopInteractiveAction;
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
    /** Agent SDK 消息类型（持久化，用于前端聚合中间过程） */
    sdkMessageType?: string;
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

/** 跨阶段 @mention 触发的 Agent 挂起状态（持久化，便于恢复） */
export interface AgentRoutingState {
  suspendedAgent?: AgentRole;
  /** 挂起时的开发模式（外部工具开发暂停后用于恢复） */
  suspendedDevelopmentMode?: DevelopmentMode;
  suspendedAt?: string;
  suspendedBy?: string;
}

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
