# Docker 构建与 CI/CD 参考

> PostgreSQL / Redis 使用公司托管服务，镜像内不包含数据库。
> PM / Dev / Ops Agent 作为库内嵌在 **orchestrator** 镜像中，无需单独构建。

## 镜像列表

| 镜像 | Dockerfile | 端口 | 说明 |
|------|------------|------|------|
| `loop-orchestrator` | `packages/orchestrator/Dockerfile` | 3000 | API、状态机、Agent 调度、Git |
| `loop-gateway` | `packages/gateway/Dockerfile` | 3001 | WebSocket 群聊 |
| `loop-web` | `packages/web/Dockerfile` | 3002 | Next.js 前端 |

## 本地构建（在仓库根目录执行）

```bash
docker build -f packages/orchestrator/Dockerfile -t loop-orchestrator .
docker build -f packages/gateway/Dockerfile -t loop-gateway .
docker build -f packages/web/Dockerfile \
  --build-arg NEXT_PUBLIC_ORCHESTRATOR_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_WS_URL=wss://ws.example.com \
  -t loop-web .
```

## CI/CD 流水线建议步骤

### 1. orchestrator

```bash
docker build -f packages/orchestrator/Dockerfile -t $REGISTRY/loop-orchestrator:$TAG .
docker push $REGISTRY/loop-orchestrator:$TAG
```

部署后执行一次迁移（K8s Job 或 CI 步骤）：

```bash
kubectl run loop-migrate --rm -it --restart=Never \
  --image=$REGISTRY/loop-orchestrator:$TAG \
  --env-from=secret/loop-secrets \
  -- node dist/db/migrate.js
```

### 2. gateway

```bash
docker build -f packages/gateway/Dockerfile -t $REGISTRY/loop-gateway:$TAG .
docker push $REGISTRY/loop-gateway:$TAG
```

环境变量：

| 变量 | 示例 |
|------|------|
| `ORCHESTRATOR_URL` | `http://loop-orchestrator:3000` |
| `WS_PORT` | `3001` |

### 3. web

```bash
docker build -f packages/web/Dockerfile \
  --build-arg NEXT_PUBLIC_ORCHESTRATOR_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_WS_URL=wss://ws.example.com \
  -t $REGISTRY/loop-web:$TAG .
docker push $REGISTRY/loop-web:$TAG
```

> `NEXT_PUBLIC_*` 在 **构建时** 写入前端 bundle，需在 CI 按环境传入。

## orchestrator 环境变量（K8s Secret / ConfigMap）

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | 公司 PostgreSQL 连接串 |
| `PM_MODEL_API_KEY` | 是 | PM Agent |
| `DEV_MODEL_API_KEY` | 是 | Dev Agent |
| `OPS_MODEL_API_KEY` | 是 | Ops Agent |
| `PM_MODEL_BASE_URL` | 否 | 默认 Anthropic |
| `DEV_MODEL_BASE_URL` | 否 | |
| `OPS_MODEL_BASE_URL` | 否 | |
| `WORKSPACE_ROOT` | 是 | 建议挂载 PVC，如 `/data/workspaces` |
| `ORCHESTRATOR_PORT` | 否 | 默认 3000 |
| `GIT_ACCESS_TOKEN` / `GIT_SSH_KEY_PATH` | 否 | 私有 Git |
| `LITELLM_PROXY_URL` | 否 | 自建模型网关 |

## K8s 探针建议

**gateway**（已内置 `/health`）：

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3001
```

**orchestrator / web**：可按需加 `GET /api/projects` 等接口，或先用 `tcpSocket`。

## 存储

orchestrator 需要持久化 Loop 工作区：

```yaml
volumeMounts:
  - name: workspaces
    mountPath: /data/workspaces
env:
  - name: WORKSPACE_ROOT
    value: /data/workspaces
```
