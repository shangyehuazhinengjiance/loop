# v1 退役计划

> 状态：**Phase A 进行中**（2026-06-12）  
> v2 已成为默认开发与部署路径；v1 代码保留供过渡，不再新增功能。

## 背景

| 维度 | v1 | v2 |
|------|----|----|
| 进度模型 | 固定三阶段 Phase | 子任务流 WorkStream |
| Orchestrator | NestJS `packages/orchestrator` | FastAPI `packages/orchestrator-v2` |
| Agent 运行 | 内嵌 orchestrator 进程 | 独立 `packages/agent-worker` |
| 数据库 | `loop` | `loop_v2`（不兼容） |
| UI 入口 | `/`、`/loop/:id` | `/v2`、`/v2/loop/:id` |
| Docker 镜像 | `loop-orchestrator`（单体） | `loop-orchestrator-v2` + `loop-agent-worker` |

## 分阶段退役

### Phase A — 默认切 v2（当前）

**目标**：新用户与 CI 默认走 v2，v1 只读维护。

| 动作 | 状态 |
|------|------|
| CI 构建四镜像（orchestrator-v2 / agent-worker / gateway / web） | ✅ |
| `deploy/k8s/v2/` K8s 清单 | ✅ |
| `docker-compose.v2.yml` 本地全栈 | ✅ |
| Web 首页 `/` 重定向至 `/v2` | ✅ |
| v1 页面显示废弃横幅 | ✅ |
| `packages/orchestrator/DEPRECATED.md` | ✅ |
| 文档标注 v1 为 legacy | ✅ |

**仍可使用 v1 的场景**（需自行启动）：

```bash
# 使用 loop 库（非 loop_v2）
DATABASE_URL=mysql://loop:loop@localhost:3306/loop npm run db:migrate
npm run dev:orchestrator
# UI: http://localhost:3002/v1
```

CI 仅在 `BUILD_V1=true`（Jenkins）或 workflow_dispatch 时构建 v1 镜像。

---

### Phase B — 冻结 v1（计划：v2 生产稳定后 2–4 周）

**目标**：停止 v1 功能开发与 bugfix（安全补丁除外）。

| 动作 | 说明 |
|------|------|
| 移除 `npm run dev:orchestrator` 文档推荐 | 保留脚本，README 不再提及 |
| Jenkins / GH Actions 删除 v1 构建选项 | 仅保留 v2 四镜像 |
| K8s 生产切换 `deploy/k8s/v2/` | 替换原 orchestrator Deployment |
| Secret `DATABASE_URL` 指向 `loop_v2` | 与 v1 库并行一段时间后下线 v1 库 |
| E2E 脚本改为 v2 路径 | `scripts/e2e-smoke.*` |

**数据迁移**：v1 → v2 **无自动迁移**（schema 不兼容）。存量 Loop 需人工归档或重建。

---

### Phase C — 删除 v1 代码（计划：Phase B 后 4–8 周）

**目标**：减小仓库体积与维护成本。

| 删除/归档项 | 路径 |
|-------------|------|
| NestJS Orchestrator | `packages/orchestrator/` |
| v1 根 Dockerfile | `Dockerfile`（NestJS 单体） |
| v1 迁移 | `migrations/`（非 `migrations/v2/`） |
| v1 Web 路由 | `packages/web/app/loop/`、`packages/web/app/v1/` |
| v1 组件 | `ChatRoom.tsx` 等（若 v2 已完全替代） |
| v1 K8s | `deploy/k8s/orchestrator-deployment.yaml` 等（保留 `v2/`） |

**保留**：

- `packages/agents/pm|dev|ops` — agent-worker 仍依赖
- `packages/gateway`、`packages/web`（v2 路由）
- `packages/shared`

---

## CI / 部署对照

### 镜像

| 镜像 | Dockerfile | 用途 |
|------|------------|------|
| `loop-orchestrator-v2` | `Dockerfile.orchestrator-v2` | v2 API + 编排 |
| `loop-agent-worker` | `Dockerfile.agent-worker` | PM/Dev/Ops |
| `loop-gateway` | `Dockerfile.gateway` | WebSocket |
| `loop-web` | `Dockerfile.web` | Next.js |
| ~~`loop-orchestrator`~~ | ~~`Dockerfile`~~ | v1，废弃 |

### 构建命令

```bash
# 本地 / CI 统一脚本
chmod +x scripts/build-images.sh
REGISTRY=harbor.example.com/ns TAG=$GIT_SHA ./scripts/build-images.sh

# Docker Compose 全栈
docker compose -f docker-compose.v2.yml up -d --build
```

### K8s 部署顺序（v2）

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/secret.yaml        # DATABASE_URL=.../loop_v2
kubectl apply -f deploy/k8s/v2/configmap.yaml
kubectl apply -f deploy/k8s/orchestrator-pvc.yaml
kubectl apply -f deploy/k8s/v2/migrate-job.yaml  # 等待 Complete
kubectl apply -f deploy/k8s/v2/orchestrator-deployment.yaml
kubectl apply -f deploy/k8s/v2/orchestrator-service.yaml
kubectl apply -f deploy/k8s/v2/agent-worker-deployment.yaml
kubectl apply -f deploy/k8s/v2/agent-worker-service.yaml
kubectl apply -f deploy/k8s/gateway-deployment.yaml
kubectl apply -f deploy/k8s/web-deployment.yaml
```

---

## 回滚策略

若 v2 生产出现阻塞问题：

1. **应用层**：K8s rollout 回退至上一 tag（v2 镜像）
2. **架构层**：临时恢复 v1 Deployment + `loop` 数据库（需事先保留 v1 库快照）
3. **不建议** v1/v2 双写同一 Loop

---

## 检查清单（Phase A 完成标准）

- [x] GitHub Actions 构建 v2 四镜像
- [x] Jenkinsfile 构建 v2 四镜像
- [x] `scripts/build-images.sh`
- [x] `deploy/k8s/v2/` 清单
- [x] `docker-compose.v2.yml`
- [x] 退役计划文档（本文）
- [x] Web `/` → `/v2` 重定向
- [ ] 生产环境实际切换（运维执行）
- [ ] v2 E2E 冒烟通过

---

*维护者：在 Phase 推进时更新本文「状态」与各 Phase 勾选。*
