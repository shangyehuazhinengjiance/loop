# AI Native Loop

以群聊为交互形式的 AI 协作平台：人类与 PM / Dev / Ops Agent 共同完成需求 → 开发 → 发布的完整 Loop。

**代码仓库**：https://github.com/shangyehuazhinengjiance/loop

详细设计见 [DESIGN.md](./DESIGN.md)。

## 功能概览

| Sprint | 能力 |
|--------|------|
| **Sprint 1** | Phase 状态机、PostgreSQL、WebSocket Gateway、Web UI、PM/Dev Agent、ModelRouter |
| **Sprint 2** | Git 工作区、凭证管理、Snapshot+标签、Ops Agent、阶段审批、回退+git checkout |
| **Sprint 3** | Dev Subagents、MCP 配置、LiteLLM、历史回放、Artifact 版本、沙箱、审计日志 |

## 目录结构

```
packages/
├── shared/           # 类型 + Phase 状态机
├── orchestrator/     # NestJS 编排（API / Git / 审批 / 回放 / 审计）
├── gateway/          # WebSocket 群聊网关
├── web/              # Next.js 群聊前端
└── agents/
    ├── pm/           # PM Agent（Client SDK）
    ├── dev/          # Dev Agent（Agent SDK + Hooks + Subagents）
    └── ops/          # Ops Agent（Agent SDK + MCP）
config/
├── agents.yaml       # 默认模型配置
└── litellm.yaml      # LiteLLM 网关（可选）
migrations/           # PostgreSQL 迁移
scripts/              # E2E 冒烟脚本
```

## 快速开始

### 1. 安装依赖

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

### 4. 启动服务

```bash
npm run dev:orchestrator   # :3000
npm run dev:gateway        # :3001
npm run dev:web            # :3002
```

浏览器打开 http://localhost:3002 创建 Loop 并进入群聊。

### 5. E2E 冒烟

```powershell
npm run e2e
# 或 bash scripts/e2e-smoke.sh
```

## 核心 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/projects` | 创建项目 |
| POST | `/api/projects/:id/loops` | 创建 Loop（自动 init Git 工作区） |
| POST | `/api/loops/:id/messages` | Human 发消息 |
| POST | `/api/loops/:id/approve` | 审批（approve_prd / approve_dev / approve_deploy） |
| POST | `/api/loops/:id/rollback` | 回退到指定阶段 |
| GET | `/api/loops/:id/replay` | 历史回放 |
| GET | `/api/loops/:id/artifacts` | Artifact 列表 |
| GET | `/api/loops/:id/audit` | 审计日志 |
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

## Docker / CI/CD

三个可部署服务各有 Dockerfile（构建上下文均为**仓库根目录**）：

| 服务 | Dockerfile |
|------|------------|
| orchestrator | **`Dockerfile`**（仓库根） |
| gateway | **`Dockerfile.gateway`** |
| web | **`Dockerfile.web`** |

详细构建命令、环境变量见 [deploy/DOCKER.md](./deploy/DOCKER.md)。  
K8s Deployment 分步指南见 [deploy/K8S.md](./deploy/K8S.md)。  
GitHub 仓库与 Jenkins 拉代码说明见 [deploy/GITHUB.md](./deploy/GITHUB.md)。  
GitHub → GitLab 定时镜像同步见 [scripts/SYNC.md](./scripts/SYNC.md)。

```bash
docker build -f Dockerfile -t loop-orchestrator .
```

## 测试

```bash
npm run test -w @loop/shared
```
