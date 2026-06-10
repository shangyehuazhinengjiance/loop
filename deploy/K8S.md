# Kubernetes 部署指南

> **代码仓库**：https://github.com/shangyehuazhinengjiance/loop  
> 前置条件：三个镜像已构建并推送到公司镜像仓库  
> `loop-orchestrator` / `loop-gateway` / `loop-web`  
> PostgreSQL 使用公司托管实例（集群外）

---

## 一、整体架构

```
                    ┌─────────────┐
  用户浏览器 ───────►│ Ingress     │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
      loop-web:3002  loop-orchestrator  loop-gateway:3001
           │          :3000                  │
           │               │                 │
           │               ▼                 │
           │         公司 PostgreSQL         │
           │               │                 │
           └───────────────┴─────────────────┘
                    （Web 调 API + WS）
```

| 组件 | K8s 资源 | 端口 | 配置来源 |
|------|----------|------|----------|
| Orchestrator | Deployment + Service + PVC | 3000 | ConfigMap + **Secret** |
| Gateway | Deployment + Service | 3001 | ConfigMap + 环境变量 |
| Web | Deployment + Service | 3002 | ConfigMap（仅 PORT）；**API/WS 地址在构建镜像时写入** |
| 数据库迁移 | Job（一次性） | - | Secret |

---

## 二、部署前准备清单

### 1. 镜像地址

编辑 `deploy/k8s/*-deployment.yaml` 和 `migrate-job.yaml`，将：

```yaml
image: harbor.qihoo.net/ai-native/loop-orchestrator:latest
```

替换为你们 Jenkins 实际推送的地址和 tag（建议用 `$BUILD_NUMBER` 或 git commit sha，生产避免 `latest`）。

### 2. 公司 PostgreSQL

向 DBA 申请：

- 主机、端口、库名（如 `loop`）
- 账号、密码
- 是否要求 `sslmode=require`

连接串写入 Secret 的 `DATABASE_URL`。

### 3. 模型 API Key

向 Secret 填入 `PM_MODEL_API_KEY`、`DEV_MODEL_API_KEY`、`OPS_MODEL_API_KEY`。

### 4. 存储（Orchestrator 工作区）

`orchestrator-pvc.yaml` 中：

- `storage: 20Gi` 按实际调整
- `storageClassName` 填公司 StorageClass

### 5. Web 前端地址（构建镜像时）

`NEXT_PUBLIC_*` **不在 K8s 运行时配置**，需在构建 web 镜像时传入：

```bash
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_ORCHESTRATOR_URL=https://api.loop.example.com \
  --build-arg NEXT_PUBLIC_WS_URL=wss://ws.loop.example.com \
  -t harbor.qihoo.net/ai-native/loop-web:TAG .
```

域名未定时可先用内网测试地址，后续改 build-arg 重新构建 web 镜像。

### 6. 镜像拉取凭证（如需要）

Harbor 私有仓库需在 namespace 创建 `imagePullSecrets`，并在 Deployment 中取消注释 `imagePullSecrets`。

---

## 三、分步部署（推荐顺序）

### Step 0：创建 namespace

```bash
kubectl apply -f deploy/k8s/namespace.yaml
```

### Step 1：配置 Secret（敏感信息）

```bash
cp deploy/k8s/secret.yaml.example deploy/k8s/secret.yaml
# 编辑 secret.yaml，填入 DATABASE_URL 和 API Key
kubectl apply -f deploy/k8s/secret.yaml
```

**或通过命令行创建（不落盘文件）：**

```bash
kubectl create secret generic loop-secrets -n loop \
  --from-literal=DATABASE_URL='postgresql://user:pass@pg-host:5432/loop' \
  --from-literal=PM_MODEL_API_KEY='sk-xxx' \
  --from-literal=DEV_MODEL_API_KEY='sk-xxx' \
  --from-literal=OPS_MODEL_API_KEY='sk-xxx'
```

### Step 2：配置 ConfigMap（非敏感参数）

```bash
# 按公司环境修改 deploy/k8s/configmap.yaml 后：
kubectl apply -f deploy/k8s/configmap.yaml
```

**需重点核对的项：**

| 键 | 说明 |
|----|------|
| `ORCHESTRATOR_URL` | 保持 `http://loop-orchestrator:3000`（集群内 DNS） |
| `WORKSPACE_ROOT` | 保持 `/data/workspaces`，与 PVC 挂载一致 |
| `PM_MODEL_BASE_URL` / `*_NAME` | 按实际模型供应商修改 |
| `DEV_MODEL_FAST` | Dev Subagent 用的快模型 |

### Step 3：创建 PVC

```bash
kubectl apply -f deploy/k8s/orchestrator-pvc.yaml
```

### Step 4：数据库迁移（仅首次或发版有新 migration 时）

```bash
kubectl apply -f deploy/k8s/migrate-job.yaml
kubectl wait --for=condition=complete job/loop-migrate -n loop --timeout=120s
kubectl logs job/loop-migrate -n loop
```

成功后再部署 Orchestrator。后续发版若 `migrations/` 有新增，重复此 Job（可先 `kubectl delete job loop-migrate -n loop`）。

### Step 5：部署 Orchestrator

```bash
kubectl apply -f deploy/k8s/orchestrator-deployment.yaml
kubectl apply -f deploy/k8s/orchestrator-service.yaml
kubectl rollout status deployment/loop-orchestrator -n loop
```

验证：

```bash
kubectl port-forward svc/loop-orchestrator 3000:3000 -n loop
curl -X POST http://localhost:3000/api/projects -H "Content-Type: application/json" -d '{"name":"test"}'
```

### Step 6：部署 Gateway

```bash
kubectl apply -f deploy/k8s/gateway-deployment.yaml
kubectl apply -f deploy/k8s/gateway-service.yaml
kubectl rollout status deployment/loop-gateway -n loop
```

验证：

```bash
kubectl port-forward svc/loop-gateway 3001:3001 -n loop
curl http://localhost:3001/health
```

### Step 7：部署 Web

```bash
kubectl apply -f deploy/k8s/web-deployment.yaml
kubectl apply -f deploy/k8s/web-service.yaml
kubectl rollout status deployment/loop-web -n loop
```

验证：

```bash
kubectl port-forward svc/loop-web 3002:3002 -n loop
# 浏览器打开 http://localhost:3002
```

### Step 8：配置 Ingress（域名确定后）

```bash
cp deploy/k8s/ingress.yaml.example deploy/k8s/ingress.yaml
# 修改 host 后
kubectl apply -f deploy/k8s/ingress.yaml
```

同时用 Ingress 域名**重新构建 web 镜像**（见第二节第 5 点）。

---

## 四、各服务环境变量明细

### Orchestrator（ConfigMap + Secret）

| 变量 | 来源 | 必填 | 说明 |
|------|------|------|------|
| `DATABASE_URL` | Secret | ✅ | PostgreSQL 连接串 |
| `PM_MODEL_API_KEY` | Secret | ✅ | |
| `DEV_MODEL_API_KEY` | Secret | ✅ | |
| `OPS_MODEL_API_KEY` | Secret | ✅ | |
| `ORCHESTRATOR_PORT` | ConfigMap | | 默认 3000 |
| `ORCHESTRATOR_URL` | ConfigMap | ✅ | 集群内 `http://loop-orchestrator:3000` |
| `WORKSPACE_ROOT` | ConfigMap | ✅ | `/data/workspaces` |
| `PM_MODEL_BASE_URL` | ConfigMap | | |
| `PM_MODEL_NAME` | ConfigMap | | |
| `DEV_MODEL_*` | ConfigMap | | |
| `OPS_MODEL_*` | ConfigMap | | |
| `GIT_ACCESS_TOKEN` | Secret | | 私有 Git |
| `LITELLM_PROXY_URL` | ConfigMap | | 可选 |

### Gateway

| 变量 | 来源 | 必填 | 说明 |
|------|------|------|------|
| `ORCHESTRATOR_URL` | Deployment env | ✅ | `http://loop-orchestrator:3000` |
| `WS_PORT` | ConfigMap | | 默认 3001 |

### Web

| 变量 | 来源 | 必填 | 说明 |
|------|------|------|------|
| `PORT` | ConfigMap | | 3002 |
| `HOSTNAME` | ConfigMap | | `0.0.0.0` |
| `NEXT_PUBLIC_ORCHESTRATOR_URL` | **构建镜像时** build-arg | ✅ | 浏览器访问的 API 地址 |
| `NEXT_PUBLIC_WS_URL` | **构建镜像时** build-arg | ✅ | 浏览器 WebSocket 地址 |

---

## 五、发版更新流程

```bash
# 1. Jenkins 构建并推送新 tag 的三个镜像
# 2. 更新 deployment 中的 image tag
kubectl set image deployment/loop-orchestrator orchestrator=harbor.../loop-orchestrator:NEW_TAG -n loop
kubectl set image deployment/loop-gateway gateway=harbor.../loop-gateway:NEW_TAG -n loop
kubectl set image deployment/loop-web web=harbor.../loop-web:NEW_TAG -n loop

# 3. 若有新 migration
kubectl delete job loop-migrate -n loop --ignore-not-found
kubectl apply -f deploy/k8s/migrate-job.yaml

# 4. 观察滚动更新
kubectl rollout status deployment/loop-orchestrator -n loop
```

---

## 六、常见问题

**Q：Web 页面能开，但创建 Loop 失败？**  
A：检查 web 镜像构建时的 `NEXT_PUBLIC_ORCHESTRATOR_URL` 是否为用户浏览器能访问的地址（不是集群内 `loop-orchestrator`）。

**Q：群聊连不上？**  
A：检查 `NEXT_PUBLIC_WS_URL` 是否为 `wss://` 且 Ingress 支持 WebSocket 长连接。

**Q：Orchestrator Pod 启动后 Crash？**  
A：`kubectl logs deployment/loop-orchestrator -n loop`，常见为 `DATABASE_URL` 错误或连不上 PG。

**Q：Dev Agent 写不了代码？**  
A：检查 PVC 是否 Bound，`WORKSPACE_ROOT` 与 mountPath 是否一致。

---

## 七、一键应用（熟练后）

```bash
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/configmap.yaml
kubectl apply -f deploy/k8s/secret.yaml          # 需先自行创建
kubectl apply -f deploy/k8s/orchestrator-pvc.yaml
kubectl apply -f deploy/k8s/migrate-job.yaml
kubectl wait --for=condition=complete job/loop-migrate -n loop --timeout=120s
kubectl apply -f deploy/k8s/orchestrator-deployment.yaml
kubectl apply -f deploy/k8s/orchestrator-service.yaml
kubectl apply -f deploy/k8s/gateway-deployment.yaml
kubectl apply -f deploy/k8s/gateway-service.yaml
kubectl apply -f deploy/k8s/web-deployment.yaml
kubectl apply -f deploy/k8s/web-service.yaml
```
