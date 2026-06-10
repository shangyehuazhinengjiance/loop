# Loop 基础镜像（依赖预装）

业务镜像构建时 **不再执行 npm install/ci**，从 Harbor 拉取已装好 `node_modules` 的基础层，显著缩短日常流水线时间。

## 需要几个基础镜像？

| # | 镜像名 | 用途 | 用于 |
|---|--------|------|------|
| 1 | `loop-base-monorepo-builder` | 全 monorepo 开发依赖 `npm ci` | `Dockerfile`、`Dockerfile.gateway` **编译阶段** |
| 2 | `loop-base-orchestrator-runner` | orchestrator 生产依赖 + git/bash | `Dockerfile` **运行阶段** |
| 3 | `loop-base-gateway-runner` | gateway 生产依赖 | `Dockerfile.gateway` **运行阶段** |
| 4 | `loop-base-web-builder` | Next.js 构建依赖 | `Dockerfile.web` **编译阶段** |

共 **4 个**基础镜像。Web 运行镜像只拷贝 `.next/standalone`，不需要第 5 个 runtime 基础镜像。

## 何时重建基础镜像？

仅在以下文件变更时重建并 push（建议 tag 用日期或 lock 文件短 hash）：

- 根目录 `package-lock.json`
- 任意 `packages/**/package.json` 的 `dependencies` / `devDependencies`

日常只改 `.ts` / `.tsx` 业务代码：**只构建业务镜像**，拉取已有 `BASE_TAG` 即可。

## 一次性构建并推送

```bash
export REGISTRY=harbor.qihoo.net/ai-native
export TAG=20250609          # 或 $(git rev-parse --short HEAD:package-lock.json) 等

./scripts/build-base-images.sh
# 或分别 build push，见脚本内容
```

## 公司业务镜像构建

```bash
export REGISTRY=harbor.qihoo.net/ai-native
export BASE_TAG=20250609     # 与基础镜像 tag 一致

docker build -f Dockerfile \
  --build-arg BASE_REGISTRY=$REGISTRY \
  --build-arg BASE_TAG=$BASE_TAG \
  -t $REGISTRY/loop-orchestrator:$CI_TAG .

docker build -f Dockerfile.gateway \
  --build-arg BASE_REGISTRY=$REGISTRY \
  --build-arg BASE_TAG=$BASE_TAG \
  -t $REGISTRY/loop-gateway:$CI_TAG .

docker build -f Dockerfile.web \
  --build-arg BASE_REGISTRY=$REGISTRY \
  --build-arg BASE_TAG=$BASE_TAG \
  --build-arg NEXT_PUBLIC_ORCHESTRATOR_URL=... \
  --build-arg NEXT_PUBLIC_WS_URL=... \
  -t $REGISTRY/loop-web:$CI_TAG .
```

## 架构示意

```
package-lock.json 变更 ──► 重建 4 个 loop-base-* 并 push
                                    │
日常代码变更 ────────────────────────┼──► docker build Dockerfile*
                                    │         FROM loop-base-*（秒级拉取 + 编译/拷贝）
                                    ▼
                              loop-orchestrator / gateway / web
```
