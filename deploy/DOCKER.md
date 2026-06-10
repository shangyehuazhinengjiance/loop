# Docker 构建与 CI/CD 参考

> MySQL / Redis 使用公司托管服务，镜像内不包含数据库。
> PM / Dev / Ops Agent 作为库内嵌在 **orchestrator** 镜像中，无需单独构建。

## 镜像列表

### 业务镜像

| 镜像 | Dockerfile | 端口 | 说明 |
|------|------------|------|------|
| `loop-orchestrator` | **`Dockerfile`**（仓库根） | 3000 | API、状态机、Agent 调度、Git |
| `loop-gateway` | **`Dockerfile.gateway`** | 3001 | WebSocket 群聊 |
| `loop-web` | **`Dockerfile.web`** | 3002 | Next.js 前端 |

### 基础镜像（依赖预装，共 4 个，Dockerfile 在仓库根目录）

与业务镜像相同：**context 均为 `.`**，公司流水线只需改 Dockerfile 文件名。

| 镜像 | Dockerfile（仓库根） | 说明 |
|------|----------------------|------|
| `loop-base-monorepo-builder` | **`Dockerfile.base-monorepo-builder`** | monorepo `npm ci`，orchestrator/gateway 编译 |
| `loop-base-orchestrator-runner` | **`Dockerfile.base-orchestrator-runner`** | orchestrator 运行依赖 + git/bash |
| `loop-base-gateway-runner` | **`Dockerfile.base-gateway-runner`** | gateway 运行依赖 |
| `loop-base-web-builder` | **`Dockerfile.base-web-builder`** | Next.js 编译依赖 |

```bash
# 示例（与 Dockerfile 业务构建相同，仅 -f 不同）
docker build --platform linux/amd64 \
  -f Dockerfile.base-monorepo-builder \
  -t $REGISTRY/loop-base-monorepo-builder:$TAG .

./scripts/build-base-images.sh   # 一次构建并 push 四个基础镜像
```

`package-lock.json` 变更时重建基础镜像；日常业务构建传入 `BASE_REGISTRY` / `BASE_TAG` 即可。

> 备选：`packages/orchestrator/Dockerfile` 内容与根目录 `Dockerfile` 相同，但 **context 仍必须是 `.`**

## 公司标准流水线（无需 BuildKit）

三个 Dockerfile **头部注释**已写明构建命令。使用标准 `docker build` 即可，**不需要** `DOCKER_BUILDKIT=1`，兼容 Docker 18.09+。

依赖加速靠 **分层 COPY**（先 `package.json` + `package-lock.json`，再 `npm ci` / `npm install`，最后拷源码），锁文件未变时复用镜像层。

## 构建上下文（重要）

**必须把仓库根目录 `.` 作为 build context**，不能只传 `packages/orchestrator`：

```bash
# 正确：最后一个参数是 .
docker build -f packages/orchestrator/Dockerfile -t loop-orchestrator .

# 错误：会报 packages/shared/package.json not found
docker build -t loop-orchestrator packages/orchestrator
docker build -f packages/orchestrator/Dockerfile packages/orchestrator
```

**典型报错与原因：**

```
COPY failed: stat packages/shared/package.json: file does not exist
```

→ CI 把 `packages/orchestrator` 当成了 build context，应改为仓库根目录 `.`

**Jenkins 正确写法**（参考仓库根 `Jenkinsfile`）：

```groovy
sh 'docker build -f Dockerfile -t $IMAGE .'
```

Jenkins / GitHub Actions 示例：

```groovy
// Jenkins（Git 源：GitHub）
// Job 配置 Repository URL: https://github.com/shangyehuazhinengjiance/loop.git
sh 'docker build -f Dockerfile -t $IMAGE .'
```

```yaml
# GitHub Actions — 见 .github/workflows/docker-build.yml
```

## 本地构建（在仓库根目录执行）

```bash
docker build -f Dockerfile -t loop-orchestrator .
docker build -f Dockerfile.gateway -t loop-gateway .
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_ORCHESTRATOR_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_WS_URL=wss://ws.example.com \
  -t loop-web .
```

## CI/CD 流水线建议步骤

### 1. orchestrator

```bash
docker build -f Dockerfile -t $REGISTRY/loop-orchestrator:$TAG .
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
docker build -f Dockerfile.gateway -t $REGISTRY/loop-gateway:$TAG .
docker push $REGISTRY/loop-gateway:$TAG
```

环境变量：

| 变量 | 示例 |
|------|------|
| `ORCHESTRATOR_URL` | `http://loop-orchestrator:3000` |
| `WS_PORT` | `3001` |

### 3. web

```bash
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_ORCHESTRATOR_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_WS_URL=wss://ws.example.com \
  -t $REGISTRY/loop-web:$TAG .
docker push $REGISTRY/loop-web:$TAG
```

> `NEXT_PUBLIC_*` 在 **构建时** 写入前端 bundle，需在 CI 按环境传入。

## orchestrator 环境变量（K8s Secret / ConfigMap）

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | 公司 MySQL 连接串 |
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
