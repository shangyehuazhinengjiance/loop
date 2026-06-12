# AI Native Loop 系统 — 技术方案文档

> 版本：v2.0  
> 日期：2026-06-12  
> 用途：指导代码实现的设计规格书  
> 说明：v2 以**子任务流（WorkStream）**替代 v1 固定三阶段 Pipeline；不兼容 v1 数据模型，使用全新数据库。

---

## 1. 项目概述

### 1.1 产品定位

AI Native Loop 是一个以**群聊**为交互形式的 AI 协作平台。人类用户与多个 AI Agent 共处同一协作空间，通过灵活组合的**子任务流**完成从需求、开发到发布的完整迭代（Loop）。

与 v1 的核心差异：

| v1 | v2 |
|----|-----|
| 固定 `requirement → development → deployment` 三阶段 | Loop 由多个可并行、可重开的**子任务流**组成 |
| Agent 由阶段驱动 | Agent 与 Human **平权**，各自有独立工作流 |
| 问题靠全局 rollback | 按需 **spawn / reopen** 单条子任务流 |
| 进度看「当前阶段」 | **工作流看板**为唯一进度视图 |

### 1.2 核心设计原则

| 原则 | 说明 |
|------|------|
| 群聊即协作界面 | 消息、决策、产物在群聊中可见、可追溯 |
| 参与者平权 | Human 与 Agent 使用同一套子任务流模型，无「主阶段负责人」 |
| 子任务流即进度 | 每条流有明确开始与结束；Loop 进度 = 各流状态聚合 |
| 按需编排 | 默认零 Playbook，靠 @mention、spawn、手动建流驱动 |
| Human-in-the-Loop | 关键产出可配置 Human 确认卡点，Human 流支持灵活结束方式 |
| 局部可恢复 | 下游发现问题时重开/新建对应流，而非整 Loop 回退 |
| 总结性 Git Tag | 仅关键 Run 完成时打 Tag；临时讨论、澄清不打 Tag |
| 模型可配置 | 每个 Agent 独立模型配置，支持 LiteLLM / 私有模型 |
| 私有 Git 优先 | 私有仓库、凭证隔离、每 Loop 独立工作区 |

### 1.3 初始 Agent 阵容

| Agent | 职责 | Runtime | 推荐模型 |
|-------|------|---------|----------|
| **PM Agent** | 需求分析、PRD 撰写、任务拆解、需求修订 | Client SDK / OpenAI-compatible | 强推理 |
| **Dev Agent** | 全栈开发、测试、代码自检 | Claude Agent SDK | 代码能力 |
| **Ops Agent** | CI/CD、部署、健康检查 | Claude Agent SDK（受限工具） | 轻量/通用 |

Agent 是**参与者**之一，不拥有 Loop 的「阶段所有权」。Human 成员同样可以是子任务流的 owner。

---

## 2. 系统架构

### 2.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│                   群聊 Gateway (WebSocket)                            │
│   [Human A] [Human B]  ←→  [PM Agent] [Dev Agent] [Ops Agent]        │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│                      Loop Orchestrator                                │
│  • WorkStream 生命周期（start / block / complete / reopen / spawn）   │
│  • 依赖解析（DependencyResolver）                                     │
│  • 触发分发（@mention / git hook / webhook / approval / chat）       │
│  • 产物索引（ArtifactIndexer）                                        │
│  • 并发策略（同 owner 单 active Run）                                 │
│  • ModelRouter                                                        │
└──────┬─────────────────┬─────────────────┬───────────────────────────┘
       │                 │                 │
┌──────▼──────┐  ┌───────▼───────┐  ┌──────▼──────┐
│ PM Runtime  │  │ Dev Runtime   │  │ Ops Runtime │
│ Client SDK  │  │ Agent SDK     │  │ Agent SDK   │
└──────┬──────┘  └───────┬───────┘  └──────┬──────┘
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │
              ┌──────────▼──────────────────┐
              │   Loop Workspace (隔离)      │
              │  Git Clone / loop/{id} 分支  │
              │  总结性 Tag / Artifacts      │
              └─────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  Web UI：群聊 + 工作流看板（进行中 / 等待 / 阻塞 / 已完成）+ 统计      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 架构选型

- **协作模型**：群聊 UI + 子任务流编排（非固定 Pipeline）
- **编排方式**：中心化 Orchestrator，Agent 之间非 P2P
- **默认编排**：无预置 Playbook；UI 可提供「添加常见流」快捷操作，但不锁顺序
- **进度视图**：工作流看板为唯一主视图（不保留 v1 phase 视图）

### 2.3 技术栈

| 层级 | 技术选型 | 说明 |
|------|----------|------|
| Loop Orchestrator | **Python (FastAPI)** 或 Node.js (NestJS) | 推荐 FastAPI：无 TS 编译步骤，与 Agent 通过 HTTP/子进程通信 |
| Agent Worker | TypeScript + Claude Agent SDK | SDK 绑定 Node，独立容器/进程 |
| PM Runtime | TypeScript + Client SDK | 同上，可并入 agent worker 镜像 |
| Gateway | Python 或 Node.js | WebSocket 转发，轻量服务 |
| 持久化 | **MySQL 8** | 全新 schema，无物理外键，引用完整性在应用层 |
| 代码工作区 | 本地目录 / Docker 卷 | 每 Loop 独立 |
| Git | SSH Deploy Key / Token | 私有仓库 |
| 群聊前端 | Next.js + WebSocket | 含看板组件 |
| 模型网关（可选） | LiteLLM | 自建模型代理 |
| 密钥管理 | 环境变量 / Secret Manager | 凭证不落库明文 |

### 2.4 部署与构建策略

为缩短 Docker 构建时间，服务**拆镜像**：

| 镜像 | 内容 | 构建 |
|------|------|------|
| `loop-orchestrator` | API + 编排 + DB | Python 无 compile；或 Node + esbuild |
| `loop-agent-worker` | pm / dev / ops | 仅 agent 包 `tsc` 或 tsup |
| `loop-gateway` | WebSocket | 轻量 |
| `loop-web` | Next.js standalone | 仅 web 变更时重建 |

Orchestrator 与 Agent 分离后，改编排逻辑不再触发 4 个 agent 包编译。

---

## 3. 核心概念

### 3.1 概念定义

| 概念 | 定义 |
|------|------|
| **Loop** | 一次完整迭代容器，包含群聊、Git 工作区、多条子任务流 |
| **Participant** | 参与者：Human 或 Agent，平权 |
| **WorkStreamTemplate** | 子任务流模板（系统级）：定义 owner 类型、开始/结束规则 |
| **WorkStreamInstance** | Loop 内的一个工作项（如「本 Loop 的 PRD 撰写」） |
| **WorkStreamRun** | Instance 的一次执行；支持 v1/v2/v3 重开 |
| **Artifact** | 结构化产物：PRD、代码 diff、部署 URL 等 |
| **Summary Tag** | 关键 Run 完成时在 Git 打的总结性 Tag |
| **Spawn** | 下游发现问题时新建一条子任务流 |
| **Reopen** | 将已有 Instance 重新执行（产生新 Run） |

### 3.2 三层模型

```
WorkStreamTemplate（模板，系统注册表）
    └── WorkStreamInstance（实例，属于某个 Loop）
            └── WorkStreamRun（一次执行，version = 1, 2, 3…）
```

### 3.3 Loop 实体

```typescript
interface Loop {
  id: string;
  title: string;
  status: LoopStatus;
  projectId: string;

  participants: Participant[];

  git: {
    remoteUrl: string;
    branch: string;           // loop/{loopId}
    defaultBranch: string;
    credentialRef: string;
  };

  workspacePath: string;

  /** 聚合上下文，由各 Run 产出写入 */
  context: LoopContext;

  modelOverrides?: Partial<ProjectModelConfig>;

  /** 可选里程碑，如「v1.2 发布」；非必填 */
  milestone?: {
    title: string;
    status: 'open' | 'achieved' | 'cancelled';
  };

  createdAt: string;
  updatedAt: string;
}

type LoopStatus = 'active' | 'blocked' | 'done' | 'archived';
```

> v2 **移除** `phase` 字段。Loop 是否 blocked 由是否存在 `blocked` 状态的 Run 派生。

### 3.4 Participant（参与者平权）

```typescript
type ParticipantKind = 'human' | 'agent';

interface Participant {
  kind: ParticipantKind;
  id: string;              // 'pm-agent' | 'dev-agent' | userId
  displayName: string;
  capabilities?: string[]; // ['prd', 'coding', 'deploy', 'review', 'merge']
}
```

- Agent ID：`pm-agent`、`dev-agent`、`ops-agent`（可扩展）
- Human ID：`user:{userId}`；群聊 @ 格式 `@human-{userId}`
- Human 与 Agent 的 Run 使用相同状态机与 API

---

## 4. 子任务流（WorkStream）

### 4.1 Run 生命周期

```
pending → ready → active → completing → done
              ↘ blocked ↗
              ↘ cancelled
              ↘ reopened → 新 Run (version + 1)
```

| 状态 | 含义 |
|------|------|
| `pending` | 已创建 Instance，依赖未满足 |
| `ready` | 依赖满足，等待 @ 或手动 start |
| `active` | 执行中（Agent 运行或 Human 处理中） |
| `blocked` | 等待外部输入，可指派 assignee |
| `completing` | 已满足结束条件，等待可选确认 gate |
| `done` | 本轮结束，产出已落库 |
| `cancelled` | 主动取消 |

### 4.2 Run 实体

```typescript
interface WorkStreamRun {
  id: string;
  instanceId: string;
  loopId: string;
  templateId: string;
  version: number;

  owner: Participant;
  assignee?: Participant;     // Human 流可覆盖默认 assignee

  status: WorkStreamStatus;

  startedAt?: string;
  endedAt?: string;
  startedBy?: Participant;

  blockedReason?: string;
  spawnedFrom?: string;       // 发起 spawn 的 runId
  supersedes?: string;        // reopen 时指向上一 Run

  outputs: ArtifactRef[];

  gitRefAtStart?: string;
  gitRefAtEnd?: string;

  /** 完成时打的 summary tag（若模板配置） */
  summaryTag?: string;

  metadata: Record<string, unknown>;
}

interface WorkStreamInstance {
  id: string;
  loopId: string;
  templateId: string;
  title: string;
  assigneeId?: string;
  createdAt: string;
}
```

### 4.3 开始条件（Start Triggers）

```typescript
type StartTrigger =
  | { type: 'mention'; target: string }
  | { type: 'manual'; by: 'any_human' | string }
  | { type: 'loop_entry' }
  | { type: 'upstream_done'; instanceRef: string; kind?: 'hard' | 'soft' }
  | { type: 'artifact_exists'; path: string }
  | { type: 'spawn'; fromRunId: string; reason: string };
```

**PM 撰写 PRD 示例：**

```yaml
template: pm-prd
owner: pm-agent
start:
  - mention: pm-agent
end:
  - artifact_committed:
      path: "docs/loop/{loopId}/PRD.md"
  - optional_gate: human_approve_prd
tag_on_complete:
  prefix: prd
  paths: ["docs/loop/{loopId}/PRD.md"]
```

- `@pm-agent` → 若 Instance 不存在则创建 → Run 进入 `active` → 激活 PM Worker
- 默认**不**在 Loop 创建时自动 spawn 任何流

### 4.4 结束条件（End Conditions）

**Agent Run**：以可验证事件为主。

```typescript
type AgentEndCondition =
  | { type: 'artifact_committed'; path: string; validator?: string }
  | { type: 'approval'; action: string }
  | { type: 'external_webhook'; event: string }
  | { type: 'test_passed'; command?: string };
```

**Human Run**：灵活多通道（`end_any_of`，满足任一即可）。

```typescript
type HumanEndSignal =
  | { type: 'explicit_action'; actionId: string }
  | { type: 'chat_intent'; patterns: string[] }
  | { type: 'artifact_committed'; path: string }
  | { type: 'external_webhook'; event: string }
  | { type: 'peer_confirm'; by: 'any_human' | string };
```

**Human 灵活结束规则：**

1. 模板配置 `end_any_of` 列表，至少一种
2. `chat_intent` 命中后发送确认卡片「是否标记为完成？」，避免误触
3. `peer_confirm` 允许其他成员代为确认
4. `external_webhook` 对接 Git MR merged、CI passed 等

**Human MR 合并示例：**

```yaml
template: human-mr-merge
owner: human
start:
  - upstream_done: dev-impl
end_any_of:
  - external_webhook: merge_request.merged
  - explicit_action: confirm_mr_merged
  - chat_intent: ["已合并", "MR merged", "合完了"]
  - peer_confirm: { by: any_human }
ephemeral: true   # 不打 Git Tag
```

### 4.5 Spawn 与 Reopen（替代 v1 Rollback）

| 场景 | 动作 |
|------|------|
| Dev 发现 PRD 歧义 | Dev Run → `blocked`；spawn `pm-revision` |
| 部署发现代码 bug | reopen `dev-impl` → Run v2 |
| 部署发现需求理解错误 | reopen `pm-prd` + 可选 reopen `dev-impl` |
| 需整体恢复 | 批量 reopen 选定 Instances + `git checkout` 到对应 `summaryTag` |

```typescript
// Reopen API
POST /api/loops/:id/workstreams/:instanceId/reopen
Body: { reason: string; gitCheckout?: boolean }

// Spawn API
POST /api/loops/:id/workstreams/spawn
Body: {
  templateId: string;
  fromRunId?: string;
  reason: string;
  assigneeId?: string;
}
```

Reopen 产生新 Run（`version + 1`），旧 Run 保留，历史不删除。

### 4.6 依赖关系

```typescript
interface WorkStreamDependency {
  instanceId: string;
  dependsOnId: string;
  kind: 'hard' | 'soft';  // soft = 可警告后强制 start
}
```

- `hard`：上游未完成则保持 `pending`
- `soft`：UI 提示依赖未满足，Human 可强制 start

依赖图允许**非线性**结构：Dev 进行中可并行 spawn PM 修订流，修订完成后 Dev 从 `blocked` 恢复。

### 4.7 并发策略

| 规则 | 说明 |
|------|------|
| 同 owner 单 active | 同一 Participant 同时只有一个 `active` Run |
| 跨 owner 可并行 | Dev 写代码 + PM 改文档 + Human 审 MR 可同时进行 |
| Git 写冲突 | 同路径写入由分支策略 / 文件锁协调；冲突时 Run → `blocked` |

---

## 5. 内置 WorkStream 模板

首版种子模板（系统注册，Loop 创建时不自动实例化）：

| Template ID | Owner | 开始 | 结束 | Tag | 备注 |
|-------------|-------|------|------|-----|------|
| `pm-prd` | pm-agent | @pm-agent | PRD.md commit + optional approve_prd | prd | |
| `pm-revision` | pm-agent | spawn | PRD 新版本 commit | prd | 关联 parent Run |
| `pm-clarify` | pm-agent | @ / spawn | chat 确认 / human_confirm | — | `ephemeral: true` |
| `dev-impl` | dev-agent | @dev-agent | 测试通过 + approve_dev | dev | 支持 external 模式 |
| `human-mr-merge` | human | upstream / manual | end_any_of | — | ephemeral |
| `human-test-verify` | human | upstream | approve_test | — | ephemeral |
| `ops-deploy-test` | ops-agent | @ / upstream | staging URL + 健康检查 | staging | |
| `ops-deploy-prod` | ops-agent | upstream | prod URL + approve_deploy | release | |
| `human-freeform` | human | @ / manual | end_any_of | — | ephemeral |

模板注册表示例：

```yaml
# config/workstream-templates.yaml
templates:
  - id: pm-prd
    name: PM 撰写 PRD
    owner_kind: agent
    default_owner: pm-agent
    ephemeral: false
    tag_on_complete:
      prefix: prd
      paths: ["docs/loop/{loopId}/PRD.md"]
    start:
      - type: mention
        target: pm-agent
    end:
      - type: artifact_committed
        path: "docs/loop/{loopId}/PRD.md"
      - type: approval
        action: approve_prd
        optional: true

  - id: pm-clarify
    name: PM 需求澄清
    owner_kind: agent
    default_owner: pm-agent
    ephemeral: true
    start:
      - type: mention
        target: pm-agent
      - type: spawn
    end:
      - type: explicit_action
        actionId: clarify_done
```

### 5.1 Loop 完成条件

以下任一即可将 Loop 标记为 `done`：

1. Human 手动「关闭 Loop」
2. 可选 milestone 标记为 `achieved`
3. 配置的必要模板列表全部 `done`（项目级配置，非 Playbook 预置）

默认创建 Loop 时**无必要模板列表**。

---

## 6. Git 与 Summary Tag

### 6.1 工作区生命周期

与 v1 相同：创建 Loop 时 clone 私有仓库，创建 `loop/{loopId}` 分支。

```typescript
async function initLoopWorkspace(loop: Loop, project: ProjectConfig): Promise<string> {
  const workspace = `${WORKSPACE_ROOT}/loop-${loop.id}`;
  // 1. 解析凭证
  // 2. git clone
  // 3. git checkout -b loop/{loopId}
  return workspace;
}
```

### 6.2 Summary Tag 策略

**仅关键 Run 完成时打 Tag**，临时流（`ephemeral: true`）永不打 Tag。

| Tag 前缀 | 触发模板 | 格式示例 |
|----------|----------|----------|
| `prd` | pm-prd, pm-revision | `loop/{loopId}/summary/prd-v{n}` |
| `dev` | dev-impl | `loop/{loopId}/summary/dev-v{n}` |
| `staging` | ops-deploy-test | `loop/{loopId}/summary/staging-v{n}` |
| `release` | ops-deploy-prod | `loop/{loopId}/summary/release-v{n}` |

打 Tag 前校验 `tag_on_complete.paths` 均存在且已 commit。

**不打 Tag 的内容：**

- 群聊澄清、临时讨论
- `pm-clarify`、`human-freeform` 等 ephemeral 流
- 仅更新 Loop 内 MEMORY/HISTORY 的笔记

### 6.3 分支策略

```
private-repo (main)
└── loop/{loopId}
    ├── tag: loop/{id}/summary/prd-v1
    ├── tag: loop/{id}/summary/dev-v1
    ├── tag: loop/{id}/summary/dev-v2    ← reopen 后
    └── tag: loop/{id}/summary/release-v1
```

Reopen + `gitCheckout: true` 时，checkout 到目标 Run 的 `summaryTag` 或 `gitRefAtEnd`。

### 6.4 凭证与安全

| 措施 | 实现 |
|------|------|
| 最小权限 | Deploy Key 仅授权必要仓库 |
| 凭证不落盘 | Secret Manager / 环境变量 |
| 工作区隔离 | 每 Loop 独立目录 |
| Push 策略 | 默认 push 到 `loop/{id}` 分支 |
| 敏感文件拦截 | Agent PreToolUse Hook 阻止 `.env` 等 |
| 操作审计 | git push、Tag 创建写入 audit + 群聊 |

---

## 7. 群聊与协作

### 7.1 消息协议

```typescript
interface LoopMessage {
  id: string;
  loopId: string;
  runId?: string;              // 关联子任务流 Run
  sender: {
    type: 'human' | 'agent' | 'system';
    id: string;
    displayName: string;
  };
  content: {
    type: MessageContentType;
    body: string;
    artifacts?: Artifact[];
    mentions?: string[];
    actions?: Action[];
  };
  metadata: {
    timestamp: string;
    parentMessageId?: string;
    sdkMessageType?: string;
  };
}

type MessageContentType =
  | 'text'
  | 'artifact'
  | 'action'
  | 'mention'
  | 'workstream_event'   // 替代 v1 phase_transition
  | 'approval'
  | 'spawn'
  | 'reopen';
```

**workstream_event 示例：**

```json
{
  "type": "workstream_event",
  "event": "blocked",
  "runId": "...",
  "templateId": "dev-impl",
  "reason": "PRD 中登录流程描述矛盾",
  "spawnedTemplateId": "pm-revision"
}
```

### 7.2 @mention 与触发

| 触发 | 行为 |
|------|------|
| `@pm-agent` | 查找/创建 pm-prd Instance → start Run → 激活 PM |
| `@dev-agent` | 同上，dev-impl |
| `@human-{userId}` | 通知成员；若消息含「请你」+ 模板名，可创建 Human Run |
| 消息内无 @ | 仅广播；Orchestrator 可检测 chat_intent 用于 Human Run 结束 |

### 7.3 Human 协作

| 能力 | 设计 |
|------|------|
| 发言 | 所有 Human 平等 |
| 决策 | 关键 Action 任一 Human 点击即生效 |
| 无锁 | 不设「当前负责人」 |
| 审计 | 记录 `completedBy: userId` |
| @Agent | 任意 Human 可 @ |

### 7.4 创建 Loop 时导入需求

可选粘贴 Markdown，逻辑保留，但**不自动 spawn pm-prd**：

```
POST /api/projects/{id}/loops
  { title, inputRequirements?, inputRequirementsTitle? }
        │
        ▼
Git 工作区初始化
        │
        ▼
写入 docs/loop/{loopId}/INPUT_REQUIREMENTS.md
        │
        ▼
context.inputRequirements + 群聊系统消息
        │
        ▼
等待 Human @pm-agent 或手动添加「PM 撰写 PRD」流
```

---

## 8. 工作流看板与统计

### 8.1 Loop 内看板（主视图）

Loop 详情页布局：

```
┌─ 顶栏：标题 | status | Git 分支 | 成员 ─────────────────────────────┐
├─ 看板 ────────────────────────────────────────────────────────────────┤
│  [进行中 2]  [等待 1]  [阻塞 1]  [已完成 3]                            │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ ▶ PM 撰写 PRD v2     active    pm-agent    2h    [查看] [取消]  │ │
│  │ ▶ Dev 实现登录       active    dev-agent   45m   [查看] [取消]  │ │
│  │ ○ 合并 test MR       ready     未指派          [指派] [开始]   │ │
│  │ ⚠ PM 修订 PRD        blocked   等 PM           [查看]          │ │
│  │ ✓ Ops 部署测试       done      昨天            [查看 Tag]      │ │
│  └─────────────────────────────────────────────────────────────────┘ │
├─ 侧栏：依赖简图 + Summary Tag 时间线 ─────────────────────────────────┤
└─ 群聊 ───────────────────────────────────────────────────────────────┘
```

看板为**唯一进度视图**，不保留 v1 phase 标签。

### 8.2 依赖简图

- 节点 = Run（或 Instance 最新 Run）
- 边 = `depends_on` / `spawned_from`
- 阻塞链高亮（如 Dev blocked ← PM revision）

### 8.3 统计指标

**Loop 级** `GET /api/loops/:id/workstreams/stats`：

| 指标 | 说明 |
|------|------|
| 各 template 数量按 status | 进行中/阻塞/完成 |
| 平均 Run 耗时 | 按 template |
| blocked 次数与原因 | 瓶颈分析 |
| reopen 率 | 质量信号 |

**项目级** `GET /api/projects/:id/workstreams/stats`：

| 指标 | 说明 |
|------|------|
| 跨 Loop 聚合 | 同上 |
| Human vs Agent Run 占比 | 自动化程度 |
| 并行度 | 同时 active Run 数均值 |

---

## 9. Agent 设计规格

### 9.1 PM Agent

- **触发**：pm-prd / pm-revision / pm-clarify Run 进入 `active`
- **Runtime**：Client SDK，工具：`create_prd`、`breakdown_tasks`、`ask_clarification`
- **Context**：群聊历史、项目需求总结、inputRequirements、已有 PRD
- **结束**：Orchestrator 检测 `docs/loop/{id}/PRD.md` commit → Run `completing` → 可选 approve_prd → `done` + Tag

### 9.2 Dev Agent

- **触发**：dev-impl Run 进入 `active`
- **Runtime**：Claude Agent SDK；`cwd = workspacePath`；Subagents：test-runner、code-reviewer
- **Hooks**：sandboxGuard、gitCredential、audit、notifyChat
- **阻塞上游**：工具 `request_upstream_revision`，Orchestrator spawn pm-revision
- **结束**：测试通过 + approve_dev + Tag

### 9.3 Ops Agent

- **触发**：ops-deploy-* Run 进入 `active`
- **Runtime**：Agent SDK；只读业务代码；MCP：deploy、github
- **Hooks**：blockProductionDeployWithoutApproval
- **结束**：部署 URL + 健康检查 + approve_deploy + Tag

### 9.4 Agent Worker 通信

Orchestrator 与 Agent Worker 解耦：

```
Orchestrator                          Agent Worker
     │  POST /internal/runs/:id/start      │
     │  { loop, run, modelConfig, prompt }  │
     │ ─────────────────────────────────► │
     │  SSE / WS 流式事件                   │
     │ ◄───────────────────────────────── │
     │  POST /internal/runs/:id/events      │
```

同一 Loop 不同 owner 的 Run 可并行，但同一 Agent Worker 实例同一时刻只处理一个 Run（或按 agent 角色分队列）。

---

## 10. 模型配置

### 10.1 配置层级

```
系统默认 (config/agents.yaml)
    └── 项目级 (ProjectConfig.models)
        └── Loop 级 (Loop.modelOverrides)
```

### 10.2 ModelRouter

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
}
```

LiteLLM 接入方式与 v1 相同：Agent SDK 通过 `ANTHROPIC_BASE_URL` 指向代理。

---

## 11. API 设计

### 11.1 Loop 管理

```
POST   /api/projects                          创建项目
GET    /api/projects/{id}                     获取项目
POST   /api/projects/{id}/loops               创建 Loop
GET    /api/loops/{id}                        Loop 详情（含 workstream 摘要）
PATCH  /api/loops/{id}                        更新 title / milestone / status
```

### 11.2 子任务流

```
GET    /api/loops/{id}/workstreams              列表（filter: status, owner, template）
GET    /api/loops/{id}/workstreams/graph        依赖图
GET    /api/loops/{id}/workstreams/stats        Loop 级统计
GET    /api/projects/{id}/workstreams/stats     项目级统计

POST   /api/loops/{id}/workstreams              手动创建 Instance
POST   /api/loops/{id}/workstreams/spawn        Spawn
POST   /api/loops/{id}/workstreams/{instanceId}/start
POST   /api/loops/{id}/workstreams/{instanceId}/reopen
POST   /api/loops/{id}/workstreams/{runId}/block
POST   /api/loops/{id}/workstreams/{runId}/complete
POST   /api/loops/{id}/workstreams/{runId}/cancel

GET    /api/workstream-templates                系统模板目录
```

### 11.3 群聊

```
GET    /api/loops/{id}/messages               消息历史
POST   /api/loops/{id}/messages               Human 发消息
WS     /ws/loops/{id}                         实时消息
```

### 11.4 审批与动作

```
POST   /api/loops/{id}/actions
Body: {
  action: 'approve_prd' | 'approve_dev' | 'approve_deploy'
        | 'confirm_mr_merged' | 'clarify_done' | ...
  runId?: string
  note?: string
}
```

### 11.5 Agent 控制

```
POST   /api/loops/{id}/agents/{agent}/cancel      取消当前 Run
GET    /api/loops/{id}/agents/{agent}/status
```

### 11.6 其他

```
GET    /api/loops/{id}/artifacts
GET    /api/loops/{id}/audit
GET    /api/loops/{id}/replay                     基于 workstream_events + messages
```

---

## 12. 数据库 Schema（MySQL 8）

全新 schema，不兼容 v1。

### 12.1 建表原则

| 原则 | 说明 |
|------|------|
| **不使用外键** | 表间关联仅用 ID 字段 + 索引表达；不在 DDL 中声明 `FOREIGN KEY` |
| 引用完整性 | 由 **应用层**（Orchestrator / Repository）保证；删除 Loop 等操作时显式级联清理 |
| 索引 | 所有关联字段（`project_id`、`loop_id`、`instance_id`、`run_id` 等）建普通索引，保证查询性能 |
| 建表顺序 | 无外键后可按任意顺序建表，迁移脚本更简单；也可单文件批量 `CREATE TABLE` |

```sql
-- 项目
CREATE TABLE projects (
  id            CHAR(36) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  git_config    JSON NOT NULL,
  model_config  JSON NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Loop（无 phase 字段）
CREATE TABLE loops (
  id              CHAR(36) PRIMARY KEY,
  project_id      CHAR(36) NOT NULL,
  title           VARCHAR(512) NOT NULL,
  status          VARCHAR(32) NOT NULL DEFAULT 'active',
  git_branch      VARCHAR(255),
  workspace_path  VARCHAR(1024),
  context         JSON,
  model_overrides JSON,
  milestone       JSON,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_loops_project (project_id)
);

-- Loop 成员
CREATE TABLE loop_members (
  loop_id       CHAR(36) NOT NULL,
  user_id       VARCHAR(128) NOT NULL,
  display_name  VARCHAR(255) NOT NULL,
  bio           TEXT,
  joined_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (loop_id, user_id),
  INDEX idx_members_user (user_id)
);

-- 子任务流模板（种子 + 可扩展）
CREATE TABLE workstream_templates (
  id              VARCHAR(64) PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  owner_kind      VARCHAR(16) NOT NULL,
  default_owner   VARCHAR(128),
  definition      JSON NOT NULL,
  ephemeral       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 子任务流实例
CREATE TABLE workstream_instances (
  id            CHAR(36) PRIMARY KEY,
  loop_id       CHAR(36) NOT NULL,
  template_id   VARCHAR(64) NOT NULL,
  title         VARCHAR(512),
  assignee_id   VARCHAR(128),
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_instances_loop (loop_id),
  INDEX idx_instances_template (template_id)
);

-- 子任务流 Run
CREATE TABLE workstream_runs (
  id              CHAR(36) PRIMARY KEY,
  instance_id     CHAR(36) NOT NULL,
  loop_id         CHAR(36) NOT NULL,
  template_id     VARCHAR(64) NOT NULL,
  version         INT NOT NULL,
  status          VARCHAR(32) NOT NULL,
  owner_kind      VARCHAR(16) NOT NULL,
  owner_id        VARCHAR(128) NOT NULL,
  assignee_id     VARCHAR(128),
  started_at      TIMESTAMP NULL,
  ended_at        TIMESTAMP NULL,
  started_by      VARCHAR(128),
  blocked_reason  TEXT,
  spawned_from    CHAR(36),
  supersedes      CHAR(36),
  git_ref_start   VARCHAR(64),
  git_ref_end     VARCHAR(64),
  summary_tag     VARCHAR(255),
  metadata        JSON,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_runs_loop_status (loop_id, status),
  INDEX idx_runs_instance (instance_id, version),
  INDEX idx_runs_template (template_id)
);

-- 依赖
CREATE TABLE workstream_dependencies (
  instance_id     CHAR(36) NOT NULL,
  depends_on_id   CHAR(36) NOT NULL,
  kind            VARCHAR(16) DEFAULT 'hard',
  PRIMARY KEY (instance_id, depends_on_id),
  INDEX idx_deps_depends_on (depends_on_id)
);

-- 事件流（统计 + 回放）
CREATE TABLE workstream_events (
  id          CHAR(36) PRIMARY KEY,
  run_id      CHAR(36) NOT NULL,
  loop_id     CHAR(36) NOT NULL,
  event_type  VARCHAR(64) NOT NULL,
  payload     JSON,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ws_events_loop (loop_id, created_at),
  INDEX idx_ws_events_run (run_id)
);

-- 消息
CREATE TABLE messages (
  id              CHAR(36) PRIMARY KEY,
  loop_id         CHAR(36) NOT NULL,
  run_id          CHAR(36),
  sender_type     VARCHAR(16) NOT NULL,
  sender_id       VARCHAR(128) NOT NULL,
  content         JSON NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_messages_loop (loop_id, created_at),
  INDEX idx_messages_run (run_id)
);

-- 审批 / 动作记录
CREATE TABLE action_records (
  id          CHAR(36) PRIMARY KEY,
  loop_id     CHAR(36) NOT NULL,
  run_id      CHAR(36),
  action      VARCHAR(64) NOT NULL,
  actor_id    VARCHAR(128) NOT NULL,
  note        TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_actions_loop (loop_id),
  INDEX idx_actions_run (run_id)
);

-- 产物
CREATE TABLE artifacts (
  id          CHAR(36) PRIMARY KEY,
  loop_id     CHAR(36) NOT NULL,
  run_id      CHAR(36),
  type        VARCHAR(64) NOT NULL,
  path        VARCHAR(1024),
  content     JSON,
  version     INT DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_artifacts_loop (loop_id),
  INDEX idx_artifacts_run (run_id)
);

-- 审计
CREATE TABLE audit_logs (
  id          CHAR(36) PRIMARY KEY,
  loop_id     CHAR(36),
  actor       VARCHAR(128) NOT NULL,
  action      VARCHAR(128) NOT NULL,
  detail      JSON,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_loop (loop_id, created_at)
);
```

### 12.2 应用层级联约定

删除 Loop 时，Orchestrator 按依赖顺序显式删除（或软删）关联行：

```
loops → loop_members, workstream_instances, workstream_runs,
        workstream_dependencies, workstream_events, messages,
        action_records, artifacts, audit_logs
```

写入时 Repository 校验关联 ID 存在（如 `loop_id` 对应有效 Loop），避免孤儿数据。

---

## 13. 目录结构

```
loop/
├── .loop/
│   ├── DESIGN.md                 # 本文档
│   ├── README.md
│   ├── HISTORY.md
│   └── MEMORY.md
├── packages/
│   ├── orchestrator/             # FastAPI 或 NestJS 编排服务
│   ├── agent-worker/             # PM/Dev/Ops Agent（TypeScript）
│   ├── gateway/                  # WebSocket 网关
│   ├── web/                      # Next.js（群聊 + 看板）
│   └── shared/                   # 共享类型（若仍用 TS 前端/SDK）
├── config/
│   ├── agents.yaml
│   ├── workstream-templates.yaml
│   └── litellm.yaml
├── migrations/
├── scripts/
├── Dockerfile
├── Dockerfile.agent-worker
├── Dockerfile.gateway
└── Dockerfile.web
```

---

## 14. 典型场景走查

### 14.1 开发中发现需求问题

```
1. dev-impl Run v1 → blocked（PRD 矛盾）
2. Dev 调用 request_upstream_revision 或 Human 点「发起需求修订」
3. spawn pm-revision Run v1 → PM active
4. PM 更新 PRD.md → done + summary/prd-v2 Tag
5. dev-impl v1 → ready → Human @dev-agent 继续
6. 看板：PM 修订 done，Dev 待继续
```

### 14.2 部署发现代码问题

```
1. human-test-verify → reject_test
2. reopen dev-impl → Run v2
3. ops-deploy-test Instance 依赖未满足 → pending
4. dev-impl v2 done 后 ops-deploy-test 自动 ready
5. pm-prd 无需变动
```

### 14.3 从零开始（无 Playbook）

```
1. 创建 Loop，粘贴可选需求
2. 群聊 @pm-agent → 创建 pm-prd → PM 写 PRD
3. PRD done 后 @dev-agent → dev-impl
4. 需要合并时 Human 手动添加 human-mr-merge 并指派
5. @ops-agent 或添加 ops-deploy-test 流
```

---

## 15. 实施路线图

### Phase 1：核心模型（1-2 周）

- [ ] 新 MySQL schema + 迁移
- [ ] WorkStreamTemplate 注册表 + 种子数据
- [ ] Run 生命周期 API（create / start / complete / block / reopen / spawn）
- [ ] @mention → 创建/启动 Run
- [ ] 看板列表 API + 基础 Web UI
- [ ] 群聊 Gateway 接入 workstream_event

### Phase 2：Agent 集成（2-3 周）

- [ ] Agent Worker 拆独立服务
- [ ] PM / Dev / Ops 与 Run 生命周期对接
- [ ] Summary Tag 打标 + Git 集成
- [ ] Human 灵活结束（action + chat_intent 确认卡）
- [ ] 依赖解析 + blocked / ready 自动流转

### Phase 3：体验与生产化（2-3 周）

- [ ] 看板依赖简图 + Summary Tag 时间线
- [ ] 项目/Loop 级统计
- [ ] Dev Subagents、MCP、LiteLLM
- [ ] 审计、回放、Artifact 版本
- [ ] Docker 拆镜像 + CI 优化

---

## 16. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 无 Playbook 导致用户不知下一步 | UI 提供「添加常见流」快捷按钮 + 群聊 bot 建议 |
| Human chat_intent 误判 | 命中后发确认卡，不直接 complete |
| 多 Run 并行 Git 冲突 | 同 owner 单 active；冲突时 blocked + 群聊通知 |
| 子任务流过多难以浏览 | 看板分栏 + filter + 依赖简图 |
| Agent SDK 必须 Node | Orchestrator 可 Python，Agent 独立 worker |
| 非 Claude 模型工具能力弱 | Dev 优先验证过的 coding 模型；LiteLLM PoC |

---

## 17. 环境变量清单

```bash
# 数据库
DATABASE_URL=mysql://user:pass@host:3306/loop_v2

# Orchestrator
ORCHESTRATOR_PORT=3000
AGENT_WORKER_URL=http://loop-agent-worker:3010

# PM / Dev / Ops 模型（agents.yaml 可覆盖）
PM_MODEL_BASE_URL=
PM_MODEL_API_KEY=
PM_MODEL_NAME=

DEV_MODEL_BASE_URL=
DEV_MODEL_API_KEY=
DEV_MODEL_NAME=
DEV_MODEL_FAST=

OPS_MODEL_BASE_URL=
OPS_MODEL_API_KEY=
OPS_MODEL_NAME=

# Git
GIT_ACCESS_TOKEN=
GIT_SSH_KEY_PATH=
WORKSPACE_ROOT=/workspaces

# Gateway
WS_PORT=3001
ORCHESTRATOR_URL=http://loop-orchestrator:3000

# Web
NEXT_PUBLIC_ORCHESTRATOR_URL=
NEXT_PUBLIC_WS_URL=

# LiteLLM（可选）
LITELLM_PROXY_URL=
```

---

## 18. v1 → v2 变更摘要

| 移除 | 新增 |
|------|------|
| `loops.phase` | `workstream_*` 表 |
| Phase 状态机 | Run 生命周期 + DependencyResolver |
| 全局 rollback API | reopen / spawn API |
| Phase 看板 / 标签 | 工作流看板（唯一进度视图） |
| 阶段 Snapshot | Run 级 summary Tag + gitRef |
| 默认 Playbook 流程 | 零预置，@ 驱动 |
| `messages.phase` | `messages.run_id` |

---

*本文档基于 2026-06-12 设计讨论定稿，供 v2 代码实现参考。*
