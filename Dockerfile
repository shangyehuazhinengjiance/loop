# =============================================================================
# AI Native Loop — Orchestrator 镜像（v1 NestJS，已废弃）
# 新部署请使用 Dockerfile.orchestrator-v2 + Dockerfile.agent-worker
# 见 .loop/V1_RETIREMENT.md
# =============================================================================
# 【推荐】使用预装依赖的基础镜像（见 deploy/DOCKER.md）：
#
#   docker build -f Dockerfile \
#     --build-arg BASE_REGISTRY=harbor.qihoo.net/syhzqfw-sjxm-ai-native \
#     --build-arg BASE_TAG=latest \
#     -t loop-orchestrator .
#
# BASE_REGISTRY / BASE_TAG：与已推送的 loop-base-* 基础镜像一致。
# package-lock.json 变更后需先重建基础镜像：./scripts/build-base-images.sh
#
# 构建 context 必须是仓库根目录 .
# =============================================================================

ARG BASE_REGISTRY=harbor.qihoo.net/syhzqfw-sjxm-ai-native
ARG BASE_TAG=latest

FROM ${BASE_REGISTRY}/loop-base-monorepo-builder:${BASE_TAG} AS builder

WORKDIR /app

COPY packages ./packages
COPY config ./config
COPY migrations ./migrations

RUN npm run build -w @loop/shared \
 && npm run build -w @loop/agent-pm \
 && npm run build -w @loop/agent-dev \
 && npm run build -w @loop/agent-ops \
 && npm run build -w @loop/orchestrator

FROM ${BASE_REGISTRY}/loop-base-orchestrator-runner:${BASE_TAG} AS runner

ENV ORCHESTRATOR_PORT=3000

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/agents/pm/dist ./packages/agents/pm/dist
COPY --from=builder /app/packages/agents/dev/dist ./packages/agents/dev/dist
COPY --from=builder /app/packages/agents/ops/dist ./packages/agents/ops/dist
COPY --from=builder /app/packages/orchestrator/dist ./packages/orchestrator/dist
COPY --from=builder /app/config ./config
COPY --from=builder /app/migrations ./migrations

WORKDIR /app/packages/orchestrator

EXPOSE 3000

CMD ["node", "dist/main.js"]
