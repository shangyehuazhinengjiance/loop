# 已迁移

基础镜像 Dockerfile 已移至**仓库根目录**（与 `Dockerfile`、`Dockerfile.gateway` 同级），便于公司流水线统一使用 context `.`：

| 文件 |
|------|
| `Dockerfile.base-monorepo-builder` |
| `Dockerfile.base-orchestrator-runner` |
| `Dockerfile.base-gateway-runner` |
| `Dockerfile.base-web-builder` |

说明见 [deploy/DOCKER.md](../../deploy/DOCKER.md)。
