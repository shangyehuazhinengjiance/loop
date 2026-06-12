# Kubernetes 部署指南（v2）

> **代码仓库**：https://github.com/shangyehuazhinengjiance/loop  
> v2 前置条件：四个镜像已构建并推送  
> `loop-orchestrator-v2` / `loop-agent-worker` / `loop-gateway` / `loop-web`  
> MySQL 使用公司托管实例，库名 **`loop_v2`**

v1 部署说明见 [K8S.md](../K8S.md)（legacy）。

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
           │               ├──► loop-agent-worker:3010
           │               ▼                 │
           │         公司 MySQL (loop_v2)    │
           └───────────────┴─────────────────┘
```

| 组件 | K8s 资源 | 端口 | 配置来源 |
|------|----------|------|----------|
| Orchestrator v2 | Deployment + Service + PVC | 3000 | ConfigMap + Secret |
| Agent Worker | Deployment + Service + PVC | 3010 | ConfigMap + Secret |
| Gateway | Deployment + Service | 3001 | ConfigMap |
| Web | Deployment + Service | 3002 | 构建时 `NEXT_PUBLIC_*` |
| 数据库迁移 | Job（一次性） | - | Secret |

---

## 二、部署步骤

```bash
# 1. 命名空间与密钥（DATABASE_URL 指向 loop_v2）
kubectl apply -f deploy/k8s/namespace.yaml
kubectl apply -f deploy/k8s/secret.yaml

# 2. v2 配置与存储
kubectl apply -f deploy/k8s/v2/configmap.yaml
kubectl apply -f deploy/k8s/orchestrator-pvc.yaml
kubectl apply -f deploy/k8s/git-deploy-key-secret.yaml   # 若使用 SSH Git

# 3. 迁移（等待 Job Complete）
kubectl apply -f deploy/k8s/v2/migrate-job.yaml
kubectl wait --for=condition=complete job/loop-migrate-v2 -n loop --timeout=120s

# 4. 应用服务
kubectl apply -f deploy/k8s/v2/orchestrator-deployment.yaml
kubectl apply -f deploy/k8s/v2/orchestrator-service.yaml
kubectl apply -f deploy/k8s/v2/agent-worker-deployment.yaml
kubectl apply -f deploy/k8s/v2/agent-worker-service.yaml
kubectl apply -f deploy/k8s/gateway-deployment.yaml
kubectl apply -f deploy/k8s/gateway-service.yaml
kubectl apply -f deploy/k8s/web-deployment.yaml
kubectl apply -f deploy/k8s/web-service.yaml
```

---

## 三、镜像 tag

编辑 `deploy/k8s/v2/*-deployment.yaml` 与 `migrate-job.yaml` 中的：

```yaml
image: harbor.qihoo.net/ai-native/loop-orchestrator-v2:latest
```

建议使用 CI 产出的 `$BUILD_NUMBER` 或 git sha，生产避免 `latest`。

---

## 四、Secret 必填项

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | `mysql://user:pass@host:3306/loop_v2` |
| `PM_MODEL_API_KEY` | PM Agent |
| `DEV_MODEL_API_KEY` | Dev Agent |
| `OPS_MODEL_API_KEY` | Ops Agent |

ConfigMap 中 `AGENT_WORKER_URL=http://loop-agent-worker:3010` 已预置。

---

## 五、Web 镜像构建

`NEXT_PUBLIC_*` 在**构建 web 镜像时**写入，不在 K8s 运行时配置：

```bash
docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_ORCHESTRATOR_URL=https://api.loop.example.com \
  --build-arg NEXT_PUBLIC_WS_URL=wss://ws.loop.example.com \
  -t harbor.qihoo.net/ai-native/loop-web:TAG .
```

---

## 六、健康检查

| 服务 | 探针路径 |
|------|----------|
| orchestrator-v2 | `GET /api/health` |
| agent-worker | `GET /health` |
| gateway | `GET /health` |

---

## 七、从 v1 升级

1. 申请 `loop_v2` 库（与 v1 `loop` 库并行）
2. 部署 v2 四镜像（见上）
3. Web 默认入口已为 `/v2`；v1 Loop 数据**不自动迁移**
4. v1 退役时间表见 [.loop/V1_RETIREMENT.md](../../.loop/V1_RETIREMENT.md)

---

*清单文件目录：`deploy/k8s/v2/`*
