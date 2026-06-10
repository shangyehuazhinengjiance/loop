# AI Native Loop 系统 — 技术方案文档

> 版本：v1.0  
> 日期：2026-06-09  
> 用途：指导代码实现的设计规格书

---

## 1. 项目概述

### 1.1 产品定位

AI Native Loop 系统是一个以**群聊**为交互形式的 AI 协作平台。人类用户和多个 AI Agent 共处一个协作空间，共同完成从**需求分析 → 全栈开发 → 发布部署**的完整迭代周期（Loop）。

### 1.2 核心设计原则

| 原则 | 说明 |
|------|------|
| 群聊即协作界面 | 所有消息、决策、产物在群聊中可见、可追溯 |
| Agent 职责分离 | 每个 Agent 有明确边界，通过 @mention 和阶段流转协作 |
| Human-in-the-Loop | 关键决策点必须 Human 显式确认 |
| Loop 可回退 | 支持从任意阶段回退到上游阶段，不删除历史 |
| 模型可配置 | 每个 Agent 使用各自最擅长的模型，支持自建/私有模型 |
| 私有 Git 优先 | 支持私有代码仓库，凭证安全隔离 |

### 1.3 初始 Agent 阵容

| Agent | 职责 | Runtime | 推荐模型类型 |
|-------|------|---------|-------------|
| **PM Agent** | 需求分析、PRD 撰写、任务拆解 | Anthropic Client SDK / OpenAI-compatible | 强推理模型 |
| **Dev Agent** | 全栈开发、测试、代码自检 | Claude Agent SDK | 代码能力强的模型 |
| **Ops Agent** | CI/CD、部署、健康检查 | Claude Agent SDK（受限工具） | 轻量/通用模型 |

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                     群聊 Gateway (WebSocket/SSE)                   │
│   [Human A] [Human B]  ←→  [PM Agent] [Dev Agent] [Ops Agent]   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│                    Loop Orchestrator                             │
│  • Phase 状态机（含双向回退）                                      │
│  • 消息路由 / @mention 解析                                       │
│  • Human Approval 卡点                                           │
│  • Context 组装（按 Phase 裁剪）                                  │
│  • ModelRouter（按 Agent 解析模型配置）                           │
└──────┬──────────────┬──────────────┬────────────────────────────┘
       │              │              │
┌──────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
│  PM Runtime │ │ Dev Runtime │ │ Ops Runtime│
│ Client SDK  │ │ Agent SDK   │ │ Agent SDK  │
│ 可配置模型   │ │ 可配置模型   │ │ 可配置模型  │
└─────────────┘ └─────┬──────┘ └─────┬──────┘
                      │                │
              ┌───────▼────────────────▼───────┐
              │     Loop Workspace (隔离)       │
              │  私有 Git Clone / Artifacts     │
              │  Agent SDK Sessions             │
              └────────────────────────────────┘
```

### 2.2 架构选型：混合式（Pipeline + 群聊）

- **底层**：Pipeline 状态机，保证流程可控、支持回退
- **上层**：群聊 UI，保证透明度与人机协作体验
- **Orchestrator**：中心化编排，Agent 之间通过 Orchestrator 中转（非 P2P）

### 2.3 技术栈

| 层级 | 技术选型 |
|------|----------|
| Loop Orchestrator | Node.js (NestJS) 或 Python (FastAPI) |
| Dev/Ops Runtime | TypeScript + `@anthropic-ai/claude-agent-sdk` |
| PM Runtime | 同栈 + `@anthropic-ai/sdk` 或 OpenAI-compatible Client |
| 消息总线 | Redis Streams 或 PostgreSQL NOTIFY |
| 持久化 | PostgreSQL |
| 代码工作区 | 本地目录或 Docker 卷，每 Loop 独立 |
| Git | 私有仓库，SSH Deploy Key 或 Token |
| 群聊前端 | Next.js + WebSocket |
| 模型网关（可选） | LiteLLM（Anthropic/OpenAI 兼容代理） |
| 密钥管理 | Vault / 环境变量 / Secret Manager |

---

## 3. 核心概念与数据模型

### 3.1 概念定义

| 概念 | 定义 |
|------|------|
| **Loop** | 一次从需求 → 开发 → 发布的完整迭代周期 |
| **Room/Channel** | 人和 Agent 共享的群聊空间 |
| **Phase** | Loop 内的阶段：requirement / development / deployment |
| **Snapshot** | 阶段完成或 Human 确认时的状态快照，用于回退 |
| **Artifact** | 结构化产物：PRD、代码 diff、部署 URL 等 |
| **Approval** | Human 对关键决策点的显式确认 |

### 3.2 Loop 实体

```typescript
interface Loop {
  id: string;
  title: string;
  status: LoopStatus;
  phase: Phase;
  projectId: string;

  // 参与者
  participants: Participant[];

  // Git 配置
  git: {
    remoteUrl: string;
    branch: string;           // loop/{loopId}
    defaultBranch: string;    // main
    credentialRef: string;
  };

  // 工作区
  workspacePath: string;      // /workspaces/loop-{id}/

  // 结构化上下文
  context: {
    prd?: PRDDocument;
    tasks?: Task[];
    gitRef?: string;          // 当前 commit SHA
    devSessionId?: string;    // Agent SDK session
    deployment?: DeploymentInfo;
  };

  // 模型覆盖（可选，覆盖项目默认）
  modelOverrides?: Partial<ProjectModelConfig>;

  // 历史
  snapshots: LoopSnapshot[];
  phaseHistory: PhaseTransition[];
  decisions: Decision[];

  createdAt: string;
  updatedAt: string;
}

type LoopStatus = 'active' | 'done' | 'archived';
type Phase = 'created' | 'requirement' | 'development' | 'deployment' | 'done';
```

### 3.3 Snapshot 实体（回退核心）

```typescript
interface LoopSnapshot {
  id: string;
  loopId: string;
  phase: Phase;
  label: string;              // 如 "PRD v1 确认"
  createdAt: string;
  createdBy: string;          // userId 或 agentId

  // 产物快照
  prd?: PRDDocument;
  tasks?: Task[];

  // 代码快照
  gitRef: string;             // commit SHA 或 tag
  gitBranch: string;

  // Agent 会话
  devSessionId?: string;

  // 群聊水位线
  messageWatermark: string;   // 回退点之前的最后一条消息 ID
}
```

### 3.4 消息协议

```typescript
interface LoopMessage {
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
    artifacts?: Artifact[];
    mentions?: string[];       // ['pm-agent', 'dev-agent']
    actions?: Action[];        // 可点击按钮
  };
  metadata: {
    timestamp: string;
    parentMessageId?: string;
    requiresHumanApproval?: boolean;
    sdkMessageType?: string;   // Agent SDK 原始消息类型（Dev/Ops）
  };
}

type MessageContentType =
  | 'text'
  | 'artifact'
  | 'action'
  | 'mention'
  | 'phase_transition'
  | 'approval'
  | 'rollback';

interface Action {
  id: string;
  label: string;              // "确认需求" / "验收通过" / "确认发布"
  action: ApprovalActionType;
  resolved?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
}

type ApprovalActionType =
  | 'approve_prd'
  | 'approve_dev'
  | 'approve_deploy'
  | 'rollback';
```

### 3.5 项目配置

```typescript
interface ProjectConfig {
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

interface ProjectModelConfig {
  pm: ModelConfig;
  dev: ModelConfig;
  ops: ModelConfig;
}

interface ModelConfig {
  provider: 'anthropic' | 'openai-compatible' | 'bedrock' | 'vertex' | 'custom';
  baseUrl?: string;
  model: string;
  fastModel?: string;         // Subagent / 轻量任务
  apiKeyRef: string;          // 指向密钥管理，不落库明文
  maxTokens?: number;
}
```

---

## 4. Phase 状态机

### 4.1 状态流转图

```
                    ┌──────────┐
         ┌─────────│ CREATED  │
         │         └────┬─────┘
         │              │ Human 发起需求 / start
         │         ┌────▼─────────┐
    回退 │    ┌───►│ REQUIREMENT  │◄───┐
         │    │    └────┬─────────┘    │
         │    │         │ approve_prd  │ rollback / 修改需求
         │    │         ▼              │
         │    │    ┌─────────────┐     │
         └────┼────│ DEVELOPMENT │─────┘
              │    └────┬────────┘
              │         │ approve_dev
              │         ▼
              │    ┌─────────────┐
              └────│ DEPLOYMENT  │
                   └────┬────────┘
                        │ approve_deploy + 健康检查
                   ┌────▼─────┐
                   │   DONE   │
                   └──────────┘
```

### 4.2 状态转换规则

| 转换 | 触发条件 | 系统行为 |
|------|----------|----------|
| CREATED → REQUIREMENT | Human 发送首条需求消息 | 激活 PM Agent |
| REQUIREMENT → DEVELOPMENT | 任一 Human 点击「确认需求」 | 打 Snapshot → 激活 Dev Agent |
| DEVELOPMENT → DEPLOYMENT | 任一 Human 点击「验收通过」 | 打 Snapshot → 激活 Ops Agent |
| DEPLOYMENT → DONE | 部署成功 + Human 确认发布 | 打 Snapshot → Loop 完成 |
| * → REQUIREMENT | Human 命令回退 / Agent 建议 + Human 确认 | 恢复 Snapshot → 激活 PM Agent |
| DEVELOPMENT → REQUIREMENT | 同上 | git checkout + fork Dev session |
| DEPLOYMENT → DEVELOPMENT | 同上 | git checkout + 重新激活 Dev Agent |

### 4.3 回退 API

```
POST /api/loops/{loopId}/rollback
Body: {
  targetPhase: 'requirement' | 'development',
  reason: string,
  snapshotId?: string       // 可选，指定恢复到哪个快照；默认取目标阶段最新快照
}
```

回退执行步骤：

1. 查找目标 Phase 的最新 Snapshot
2. 恢复 `context.prd` / `context.tasks` 到 Snapshot 值
3. `git checkout` 到 Snapshot 的 `gitRef`（或创建 rollback 分支）
4. Dev Agent：fork 新 Agent SDK session（不 resume 旧 session）
5. 群聊发送系统消息：「已回退到 {phase} 阶段，原因：{reason}」
6. 激活目标 Phase 对应 Agent

---

## 5. Agent 设计规格

### 5.1 PM Agent

#### 职责

- 理解 Human 自然语言需求
- 产出 PRD、用户故事、验收标准
- 拆解为可开发任务列表
- 需求澄清提问（发到群聊等 Human 回复）

#### Runtime 配置

```typescript
// PM 使用 Client SDK，不依赖 Agent SDK 工具循环
const pmConfig: ModelConfig = {
  provider: 'openai-compatible',  // 或 anthropic
  baseUrl: process.env.PM_MODEL_BASE_URL,
  model: process.env.PM_MODEL_NAME,
  apiKeyRef: 'PM_MODEL_API_KEY',
};

// 调用示例
const response = await client.messages.create({
  model: pmConfig.model,
  system: PM_SYSTEM_PROMPT,
  messages: buildPMContext(loop),
  tools: [
    { name: 'create_prd', ... },
    { name: 'breakdown_tasks', ... },
    { name: 'ask_clarification', ... },
    { name: 'update_acceptance_criteria', ... },
  ],
});
```

#### 输入 Context

- 群聊历史（需求相关 Phase 的消息）
- 已有 PRD（回退场景）
- 项目约束（`constraints[]`）

#### 输出

- `artifacts/prd.md`
- `artifacts/tasks.json`
- 群聊消息 + 「确认需求」Action 按钮

#### 退出条件

任一 Human 点击「确认需求」→ Orchestrator 打 Snapshot → `phase = development`

#### 回退后行为

加载旧 PRD，对比 Human 新意见，输出 diff 版 PRD（非从零开始）。

---

### 5.2 Dev Agent

#### 职责

- 基于 PRD 和 tasks 进行全栈开发
- 直接读写代码、执行命令、运行测试
- 代码质量自检（Subagent）
- 向 PM 反问需求歧义

#### Runtime 配置

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

const devModelConfig = resolveModelConfig(loop, 'dev');

for await (const message of query({
  prompt: buildDevPrompt(loop),
  options: {
    model: devModelConfig.model,
    cwd: loop.workspacePath,
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Agent'],
    permissionMode: 'acceptEdits',
    resume: loop.context.devSessionId,  // 跨轮次续写
    env: {
      ANTHROPIC_API_KEY: resolveApiKey(devModelConfig.apiKeyRef),
      ANTHROPIC_BASE_URL: devModelConfig.baseUrl,
      ANTHROPIC_MODEL: devModelConfig.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: devModelConfig.fastModel,
    },
    hooks: {
      PreToolUse: [sandboxGuardHook, gitCredentialHook],
      PostToolUse: [auditHook, notifyChatHook],
    },
    agents: {
      'test-runner': {
        description: '运行测试并报告结果',
        prompt: '执行项目测试命令，报告通过/失败及错误信息',
        tools: ['Bash', 'Read'],
      },
      'code-reviewer': {
        description: '代码质量自检',
        prompt: '检查代码规范、安全问题和测试覆盖',
        tools: ['Read', 'Glob', 'Grep'],
      },
    },
  },
})) {
  await streamToChat(loop.id, message);
}
```

#### System Prompt 要点

- 严格遵循 PRD 和 tasks
- 改动前先 Read 相关文件
- 每次逻辑完成功能后运行测试
- 遇到 PRD 歧义时 @PMAgent 提问，不擅自假设
- 完成后发出「验收通过」Action

#### 群聊流式映射

| SDK 消息类型 | 群聊消息 |
|-------------|----------|
| `tool_use: Read` | 系统消息：「正在读取 {file}」 |
| `tool_use: Edit/Write` | Artifact 消息：文件 diff |
| `tool_use: Bash` | 系统消息：「执行：{command}」 |
| `result` | 文本消息 + 「验收通过」Action |
| Subagent 结果 | 引用消息：测试/Review 报告 |

#### Session 管理

- 每 Loop 维护一个 `devSessionId`
- 同 Phase 内多轮开发用 `resume` 续写
- 回退时 **fork 新 session**，不 resume 旧 session

#### 退出条件

测试通过（Subagent 确认）+ 任一 Human 点击「验收通过」→ Snapshot → `phase = deployment`

---

### 5.3 Ops Agent

#### 职责

- 读取 Dev 产出（Dockerfile、package.json、CI 配置）
- 生成/更新 CI/CD 配置
- 部署到 staging → 群聊发 URL
- Human 确认后部署 production
- 健康检查与回滚方案

#### Runtime 配置

```typescript
for await (const message of query({
  prompt: buildOpsPrompt(loop),
  options: {
    model: opsModelConfig.model,
    cwd: loop.workspacePath,
    allowedTools: ['Read', 'Bash', 'Glob', 'Grep'],  // 不写业务代码
    permissionMode: 'default',  // 敏感操作需审批
    env: {
      ANTHROPIC_API_KEY: resolveApiKey(opsModelConfig.apiKeyRef),
      ANTHROPIC_BASE_URL: opsModelConfig.baseUrl,
      ANTHROPIC_MODEL: opsModelConfig.model,
    },
    mcpServers: {
      deploy: { /* 云平台 MCP */ },
      github: { /* GitHub Actions MCP */ },
    },
    hooks: {
      PreToolUse: [blockProductionDeployWithoutApproval],
      PostToolUse: [auditHook, notifyChatHook],
    },
  },
})) {
  await streamToChat(loop.id, message);
}
```

#### 退出条件

- Staging 部署成功 → 群聊发 URL + 「确认发布」Action
- Production 部署成功 + 健康检查通过 → Loop DONE

---

## 6. 模型配置方案

### 6.1 配置层级

```
系统默认 (config/agents.yaml)
    └── 项目级 (ProjectConfig.models)
        └── Loop 级 (Loop.modelOverrides)
```

### 6.2 配置文件示例

```yaml
# config/agents.yaml
agents:
  pm:
    provider: openai-compatible
    base_url: ${PM_MODEL_BASE_URL}
    model: your-pm-model
    api_key_env: PM_MODEL_API_KEY
    runtime: client-sdk
    max_tokens: 8192

  dev:
    provider: anthropic-compatible
    base_url: ${DEV_MODEL_BASE_URL}
    model: your-coding-model
    fast_model: your-fast-model
    api_key_env: DEV_MODEL_API_KEY
    runtime: agent-sdk
    permission_mode: acceptEdits

  ops:
    provider: anthropic-compatible
    base_url: ${OPS_MODEL_BASE_URL}
    model: your-ops-model
    api_key_env: OPS_MODEL_API_KEY
    runtime: agent-sdk
    permission_mode: default
```

### 6.3 ModelRouter 接口

```typescript
interface ModelRouter {
  resolve(loop: Loop, agent: 'pm' | 'dev' | 'ops'): ResolvedModelConfig;
}

interface ResolvedModelConfig {
  provider: string;
  baseUrl?: string;
  model: string;
  fastModel?: string;
  apiKey: string;
  runtime: 'client-sdk' | 'agent-sdk';
  extra?: Record<string, string>;  // 传给 Agent SDK env
}
```

### 6.4 自建模型接入（LiteLLM 网关）

```
Dev/Ops Agent (Agent SDK)
    │  ANTHROPIC_BASE_URL=https://litellm.internal/v1
    │  model=your-coding-model
    ▼
LiteLLM Gateway
    ├── 自研模型 API
    ├── DeepSeek / Qwen 等
    └── 本地 vLLM / Ollama
```

**注意：** 使用非 Claude 模型时，工具调用能力需单独 PoC 验证。若 bundled CLI 忽略 `ANTHROPIC_BASE_URL`，使用系统安装的 `claude` CLI：

```python
import shutil
options = ClaudeAgentOptions(
    cli_path=shutil.which("claude"),
    env={"ANTHROPIC_BASE_URL": "http://litellm:4000", ...},
)
```

### 6.5 官方多云后端（Claude 系列）

| 环境变量 | 用途 |
|----------|------|
| `CLAUDE_CODE_USE_BEDROCK=1` | AWS Bedrock |
| `CLAUDE_CODE_USE_VERTEX=1` | Google Vertex AI |
| `CLAUDE_CODE_USE_FOUNDRY=1` | Azure AI Foundry |

---

## 7. 私有 Git 集成方案

### 7.1 工作区生命周期

```typescript
async function initLoopWorkspace(loop: Loop, project: ProjectConfig): Promise<string> {
  const workspace = `/workspaces/loop-${loop.id}`;

  // 1. 解析凭证
  const credential = await secretManager.get(project.git.credentialRef);

  // 2. Clone 私有仓库
  await exec(`
    export GIT_SSH_COMMAND="ssh -i ${credential.sshKeyPath} -o StrictHostKeyChecking=no"
    git clone ${project.git.remoteUrl} ${workspace}
  `);

  // 3. 创建 Loop 分支
  const loopBranch = `loop/${loop.id}`;
  await exec(`cd ${workspace} && git checkout -b ${loopBranch}`);

  // 4. 更新 Loop 记录
  loop.workspacePath = workspace;
  loop.git.branch = loopBranch;

  return workspace;
}
```

### 7.2 凭证管理方式

| 方式 | 适用场景 | 实现 |
|------|----------|------|
| **Deploy Key (SSH)** | 单仓库 | 每项目一把 SSH key，Git 平台配置 |
| **Personal Access Token** | GitHub/GitLab | `https://x-access-token:TOKEN@host/org/repo.git` |
| **GitHub App** | 多仓库生产环境 | 安装到 org，短期 token |
| **Secret Manager** | 生产推荐 | Vault / AWS Secrets Manager |

### 7.3 Git 分支策略

```
private-repo (main)
└── loop/{loopId}                     ← Loop 工作分支
    ├── tag: snapshot/requirement-v1   ← PRD 确认时
    ├── tag: snapshot/dev-v1           ← 开发验收时
    └── tag: snapshot/dev-v2           ← 回退后重新开发
```

### 7.4 两种仓库模式

**模式 A：基于已有私有仓库（改存量项目）**

```
Human: "在 private-app 仓库实现登录功能"
  → clone private-app
  → 创建 loop/{id} 分支
  → Dev Agent 在分支上开发
  → 完成后 Human 决定是否 merge 到 main
```

**模式 B：创建新私有仓库（新项目）**

```
Human: "新建一个用户管理系统"
  → Orchestrator 调 Git API 创建 private repo
  → Dev Agent 从零 scaffold
  → push 到新建私有仓库
```

### 7.5 安全措施

| 措施 | 实现 |
|------|------|
| 最小权限 | Deploy Key 只授权必要仓库 |
| 凭证不落盘 | 密钥放 Secret Manager，Loop 销毁时吊销 |
| 工作区隔离 | 每 Loop 独立目录，Dev Agent 不可跨 Loop 访问 |
| Push 策略 | 默认 push 到 `loop/{id}` 分支，merge main 需 Human 审批 |
| 敏感文件拦截 | PreToolUse Hook 阻止提交 `.env`、密钥文件 |
| 操作审计 | PostToolUse Hook 记录 git push 到群聊 |

---

## 8. 群聊与 Human 协作

### 8.1 多 Human 协作（线下协调）

| 能力 | 设计 |
|------|------|
| 发言 | 所有 Human 平等，消息进入同一群聊流 |
| 决策 | 关键 Action 任一 Human 点击即生效 |
| 无锁 | 不设「当前负责人」 |
| 审计 | 记录 `approvedBy: userId` |
| @Agent | 任意 Human 可 @pm-agent / @dev-agent / @ops-agent |

### 8.2 Human Approval 卡点

| 卡点 | Action | 必须/可选 |
|------|--------|-----------|
| PRD 确认 | `approve_prd` | **必须** |
| 开发验收 | `approve_dev` | **必须** |
| 生产发布 | `approve_deploy` | **必须** |
| 回退确认 | `rollback` | Agent 建议回退时需 Human 确认 |
| 技术方案 | Dev 提交方案 | 可选 |

```typescript
interface ApprovalRecord {
  type: ApprovalActionType;
  loopId: string;
  approvedBy: string;
  approvedAt: string;
  note?: string;
}
```

### 8.3 Agent 激活机制

| 触发方式 | 场景 |
|----------|------|
| Phase Entry | 进入新阶段时自动激活对应 Agent |
| @Mention | Human 或其他 Agent 显式 @调用 |
| Artifact Event | 上游产出新产物（如 PRD 确认 → 激活 Dev） |
| Human Approval | Action 按钮点击后触发下游 Agent |

**防刷屏规则：**
- 同一 Loop 同时只允许一个 Agent 处于 `active` 状态
- Orchestrator 做发言权限仲裁

---

## 9. API 设计

### 9.1 Loop 管理

```
POST   /api/projects                          创建项目
GET    /api/projects/{id}                     获取项目
POST   /api/projects/{id}/loops               创建 Loop
GET    /api/loops/{id}                        获取 Loop 详情
POST   /api/loops/{id}/start                  启动 Loop（进入 REQUIREMENT）
POST   /api/loops/{id}/rollback               回退到指定阶段
POST   /api/loops/{id}/approve                Human 审批
GET    /api/loops/{id}/snapshots              获取快照列表
```

### 9.2 群聊

```
GET    /api/loops/{id}/messages               获取消息历史（分页）
WS     /ws/loops/{id}                         WebSocket 实时消息
POST   /api/loops/{id}/messages               Human 发送消息
```

### 9.3 Agent 控制

```
POST   /api/loops/{id}/agents/{agent}/activate    手动激活 Agent
POST   /api/loops/{id}/agents/{agent}/cancel      取消当前 Agent 执行
GET    /api/loops/{id}/agents/{agent}/status      获取 Agent 状态
```

### 9.4 审批

```
POST   /api/loops/{id}/approve
Body: {
  action: 'approve_prd' | 'approve_dev' | 'approve_deploy' | 'rollback',
  note?: string
}
```

---

## 10. 数据库 Schema（PostgreSQL）

```sql
-- 项目
CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  git_config    JSONB NOT NULL,
  model_config  JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Loop
CREATE TABLE loops (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID REFERENCES projects(id),
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  phase           TEXT NOT NULL DEFAULT 'created',
  git_branch      TEXT,
  workspace_path  TEXT,
  context         JSONB DEFAULT '{}',
  model_overrides JSONB,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 消息
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id         UUID REFERENCES loops(id),
  phase           TEXT NOT NULL,
  sender_type     TEXT NOT NULL,  -- human / agent / system
  sender_id       TEXT NOT NULL,
  content         JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_messages_loop_id ON messages(loop_id, created_at);

-- 快照
CREATE TABLE snapshots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id             UUID REFERENCES loops(id),
  phase               TEXT NOT NULL,
  label               TEXT,
  prd                 JSONB,
  tasks               JSONB,
  git_ref             TEXT,
  git_branch          TEXT,
  dev_session_id      TEXT,
  message_watermark     UUID,
  created_by          TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- 审批记录
CREATE TABLE approvals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id     UUID REFERENCES loops(id),
  action      TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 阶段流转历史
CREATE TABLE phase_transitions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loop_id     UUID REFERENCES loops(id),
  from_phase  TEXT,
  to_phase    TEXT NOT NULL,
  trigger     TEXT NOT NULL,  -- approval / rollback / auto
  snapshot_id UUID REFERENCES snapshots(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## 11. 目录结构建议

```
ai-native-loop/
├── docs/
│   └── DESIGN.md                 # 本文档
├── packages/
│   ├── orchestrator/             # Loop Orchestrator 服务
│   │   ├── src/
│   │   │   ├── loop/             # Loop CRUD + 状态机
│   │   │   ├── phase/            # Phase 流转 + 回退
│   │   │   ├── chat/             # 消息路由
│   │   │   ├── approval/         # Human 审批
│   │   │   ├── snapshot/         # 快照管理
│   │   │   ├── model/            # ModelRouter
│   │   │   └── git/              # Git 工作区管理
│   │   └── package.json
│   ├── agents/
│   │   ├── pm/                   # PM Agent Runtime
│   │   ├── dev/                  # Dev Agent Runtime (Agent SDK)
│   │   └── ops/                  # Ops Agent Runtime (Agent SDK)
│   ├── gateway/                  # WebSocket 群聊 Gateway
│   └── web/                      # Next.js 群聊前端
├── config/
│   └── agents.yaml               # 默认 Agent/模型配置
├── migrations/                   # 数据库迁移
├── docker-compose.yml
└── README.md
```

---

## 12. 实施路线图

### Sprint 1：核心闭环（1-2 周）

- [ ] Loop CRUD + Phase 状态机（含 rollback API）
- [ ] PostgreSQL Schema + 迁移
- [ ] 群聊 Gateway（WebSocket）+ 基础 UI
- [ ] PM Agent（Client SDK）+ PRD 确认卡点
- [ ] Dev Agent（Agent SDK）+ 单 Loop 工作区
- [ ] Dev Agent 群聊流式同步（Hooks → 群聊）
- [ ] 项目/模型配置加载（ModelRouter）

### Sprint 2：完整 Loop（2-3 周）

- [ ] Snapshot 机制 + Git 集成（私有仓库 clone）
- [ ] 凭证管理（Deploy Key / Token）
- [ ] Ops Agent（Agent SDK + 基础 deploy）
- [ ] Human Approval 全流程
- [ ] 回退流程（Snapshot 恢复 + session fork）
- [ ] Agent 激活/取消控制 API

### Sprint 3：体验与生产化（2-4 周）

- [ ] Dev Subagents（test-runner, code-reviewer）
- [ ] MCP 集成（CI/CD、云平台）
- [ ] LiteLLM 网关接入（自建模型）
- [ ] Loop 历史回放
- [ ] Artifact 版本管理 + diff 展示
- [ ] 沙箱隔离（Docker per Loop）
- [ ] 操作审计日志

---

## 13. 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| Dev Agent 误改文件 | 每 Loop 独立 cwd；PreToolUse Hook 限制路径；Git 可回滚 |
| Bash 执行危险命令 | PreToolUse Hook 命令黑名单；生产命令需审批 |
| 非 Claude 模型工具调用差 | 上线前 PoC；PM 可换模型，Dev 优先用验证过的 coding 模型 |
| Session 上下文过长 | SDK 自动 summarization；Orchestrator 做 chatSummary 裁剪 |
| 回退后 Dev 上下文混乱 | 回退时 fork 新 session，不 resume 旧 session |
| 私有仓库凭证泄露 | Secret Manager；凭证不落盘；Loop 销毁时吊销 |
| 多 Human 重复点确认 | 幂等：同一卡点只处理第一次 approve |
| Agent SDK 计费 | 单独监控 Dev/Ops Token 用量 |

---

## 14. 关键依赖

| 依赖 | 版本/说明 |
|------|-----------|
| `@anthropic-ai/claude-agent-sdk` | Dev/Ops Agent Runtime |
| `@anthropic-ai/sdk` | PM Agent Runtime |
| NestJS 或 FastAPI | Orchestrator |
| PostgreSQL 15+ | 持久化 |
| Redis（可选） | 消息总线 |
| Next.js 14+ | 群聊前端 |
| LiteLLM（可选） | 自建模型网关 |

---

## 15. 环境变量清单

```bash
# 数据库
DATABASE_URL=postgresql://...

# PM Agent 模型
PM_MODEL_BASE_URL=https://...
PM_MODEL_API_KEY=...
PM_MODEL_NAME=your-pm-model

# Dev Agent 模型
DEV_MODEL_BASE_URL=https://...
DEV_MODEL_API_KEY=...
DEV_MODEL_NAME=your-coding-model
DEV_MODEL_FAST=your-fast-model

# Ops Agent 模型
OPS_MODEL_BASE_URL=https://...
OPS_MODEL_API_KEY=...
OPS_MODEL_NAME=your-ops-model

# Git 凭证（或通过 Secret Manager 管理）
GIT_SSH_KEY_PATH=/secrets/deploy_key
# 或
GIT_ACCESS_TOKEN=ghp_...

# 工作区
WORKSPACE_ROOT=/workspaces

# 群聊
WS_PORT=3001
```

---

*本文档基于 2026-06-09 设计讨论结论整理，供代码实现参考。*
