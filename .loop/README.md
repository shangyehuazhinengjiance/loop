# AI Native Loop

以群聊为交互形式的 AI 协作平台：人类与 PM / Dev / Ops Agent **平权协作**，通过灵活组合的**子任务流（WorkStream）**完成一次完整迭代（Loop）。

**代码仓库**：https://github.com/shangyehuazhinengjiance/loop

| 文档 | 说明 |
|------|------|
| [DESIGN.md](./DESIGN.md) | v2 技术方案（当前权威规格） |
| [HISTORY.md](./HISTORY.md) | 设计演进记录 |
| [V1_RETIREMENT.md](./V1_RETIREMENT.md) | v1 退役计划 |
| [MEMORY.md](./MEMORY.md) | 关键设计决策摘要 |

> **状态**：v2 Phase 1–3 核心能力已实现；**v1 进入退役 Phase A**（见 [V1_RETIREMENT.md](./V1_RETIREMENT.md)）。

## 核心概念（v2）

| 概念 | 说明 |
|------|------|
| **Loop** | 迭代容器：群聊 + Git 工作区 + 多条子任务流 |
| **WorkStream** | 子任务流；Human 与 Agent 使用同一套模型 |
| **Run** | 子任务流的一次执行，支持 reopen（v2、v3…） |
| **Summary Tag** | 关键 Run 完成时在 Git 打的总结性 Tag |

**与 v1 的主要变化：**

- 移除固定三阶段（requirement / development / deployment）
- 默认无 Playbook，靠 `@mention`、spawn、手动建流驱动
- 问题通过 **spawn / reopen** 单条流解决，而非全局 rollback
- **工作流看板**为唯一进度视图

## 功能路线图（v2）

| 阶段 | 能力 |
|------|------|
| **Phase 1** | WorkStream 模型、MySQL 新 schema、Run 生命周期 API、看板 UI、群聊 Gateway |
| **Phase 2** | Agent Worker、Git/Summary Tag、依赖解析、Human 灵活结束、Agent API |
| **Phase 3** | 依赖简图、项目级统计、Subagents、MCP、LiteLLM、审计与回放 ✅（CI 待更新） |

## 目录结构（v2 目标）

```
.loop/                          # 项目设计与决策文档
packages/
├── orchestrator/               # 编排服务（FastAPI 或 NestJS）
├── agent-worker/               # PM / Dev / Ops Agent（TypeScript + SDK）
├── gateway/                    # WebSocket 群聊网关
├── web/                        # Next.js（群聊 + 工作流看板）
└── shared/                     # 共享类型
config/
├── agents.yaml                 # 默认模型配置
├── workstream-templates.yaml   # 子任务流模板
└── litellm.yaml                # LiteLLM 网关（可选）
migrations/                     # MySQL 迁移（v2 schema）
scripts/                        # E2E 与工具脚本
```

## 快速开始

### v2（推荐）

**方式 A — Docker Compose 全栈：**

```bash
cp .env.example .env   # 填入模型 API Key
docker compose -f docker-compose.v2.yml up -d --build
# 或: npm run docker:compose:v2
```

打开 http://localhost:3002/v2

**方式 B — 本地开发（4 进程）：**

```bash
npm install
docker compose up -d    # 仅 MySQL / Redis
cp .env.example .env
cd packages/orchestrator-v2 && pip install -r requirements.txt
npm run db:migrate:v2
npm run dev:orchestrator-v2
npm run dev:agent-worker
npm run dev:gateway
npm run dev:web
```

> v1 已废弃，见 [V1_RETIREMENT.md](./V1_RETIREMENT.md)。legacy UI：`/v1`、`/loop/:id`。

### 1. 安装依赖（v1 参考）

```bash
npm install
```

### 2. 基础设施

```bash
docker compose up -d
cp .env.example .env
# 编辑 .env，填入 API Key
```

可选 LiteLLM：

```bash
docker compose --profile litellm up -d
# .env 中设置 LITELLM_PROXY_URL=http://localhost:4000/v1
```

### 3. 数据库迁移

```bash
npm run db:migrate
```

### 4. 启动服务（v2）

**Orchestrator v2（FastAPI，需 Python 3.11+）：**

```bash
cd packages/orchestrator-v2
pip install -r requirements.txt
npm run db:migrate:v2          # 仓库根目录；创建 loop_v2 库并迁移
npm run dev:orchestrator-v2    # 仓库根目录；:3000
npm run dev:agent-worker         # :3010
```

**Gateway + Web（与 v1 共用）：**

```bash
npm run dev:gateway            # :3001
npm run dev:web                # :3002
```

- v2 UI：http://localhost:3002/v2（默认 `/` 自动跳转）  
- v1 legacy：http://localhost:3002/v1

`.env` 中 `DATABASE_URL` 应指向 `loop_v2`（见 `.env.example`）。

### 4b. 启动服务（v1，旧版）

```bash
npm run dev:orchestrator   # NestJS v1
npm run dev:gateway
npm run dev:web
```

### 5. E2E 冒烟

```powershell
npm run e2e
# 或 bash scripts/e2e-smoke.sh
```

## 核心 API（v2）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects` | 创建项目 |
| POST | `/api/projects/:id/loops` | 创建 Loop（init Git 工作区，零预置子任务流） |
| GET | `/api/loops/:id/workstreams` | 子任务流列表 |
| GET | `/api/loops/:id/workstreams/graph` | 依赖图 |
| GET | `/api/loops/:id/workstreams/stats` | Loop 级统计摘要 |
| GET | `/api/loops/:id/workstreams/stats/detail` | Loop 详细统计 |
| GET | `/api/loops/:id/timeline` | Summary Tag 时间线 |
| GET | `/api/loops/:id/replay` | 回放数据（消息 + 事件 + Run） |
| GET | `/api/projects/:id/workstreams/stats` | 项目级统计 |
| POST | `/api/loops/:id/workstreams/spawn` | 新建子任务流（如发现需求问题） |
| POST | `/api/loops/:id/workstreams/:instanceId/reopen` | 重开子任务流 |
| POST | `/api/loops/:id/messages` | Human 发消息（可 @Agent 启动流） |
| POST | `/api/loops/:id/actions` | 审批 / 确认动作 |
| GET | `/api/loops/:id/artifacts` | Artifact 列表 |
| GET | `/api/loops/:id/audit` | 审计日志 |
| GET | `/api/workstream-templates` | 系统模板目录 |
| WS | `ws://localhost:3001/ws/loops/:id` | 群聊实时消息 |

## 私有 Git

创建项目时传入 `gitConfig`：

```json
{
  "name": "my-app",
  "gitConfig": {
    "remoteUrl": "https://github.com/org/repo.git",
    "defaultBranch": "main",
    "credentialRef": "env:GIT_ACCESS_TOKEN"
  }
}
```

凭证引用格式：`env:VAR_NAME`、`file:/path/to/key`，或默认 `GIT_ACCESS_TOKEN` / `GIT_SSH_KEY_PATH`。

**Summary Tag 格式**（仅关键 Run）：`loop/{loopId}/summary/{prd|dev|staging|release}-v{n}`

## Docker / CI/CD

v2 拆分为四个镜像（构建上下文均为**仓库根目录**）：

| 服务 | Dockerfile | 端口 |
|------|------------|------|
| orchestrator-v2 | `Dockerfile.orchestrator-v2` | 3000 |
| agent-worker | `Dockerfile.agent-worker` | 3010 |
| gateway | `Dockerfile.gateway` | 3001 |
| web | `Dockerfile.web` | 3002 |

v1 NestJS orchestrator 仍使用根目录 `Dockerfile`。详细构建说明见 [deploy/DOCKER.md](../deploy/DOCKER.md)。

```bash
docker build -f Dockerfile.orchestrator-v2 -t loop-orchestrator-v2 .
docker build -f Dockerfile.agent-worker -t loop-agent-worker .
```

## 测试

```bash
npm run test -w @loop/shared
```
