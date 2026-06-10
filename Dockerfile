# =============================================================================
# AI Native Loop — Orchestrator 镜像
# =============================================================================
# 【公司流水线】直接执行即可，无需 BuildKit / 无需自定义 Jenkinsfile：
#
#   docker build -f Dockerfile -t loop-orchestrator .
#                                              ↑ 必须是仓库根目录
#
# - 不使用 RUN --mount，兼容 Docker 18.09+ 标准构建
# - 先 COPY 各 workspace 的 package.json + package-lock.json，再 npm ci，
#   依赖未变时复用镜像层（仅改业务代码时跳过重新 npm install）
#
# 若报错 packages/shared/package.json not found → build context 不是仓库根目录
# =============================================================================

FROM harbor.qihoo.net/library/node:22.16.0-alpine AS builder

WORKDIR /app

# --- 依赖层（尽量保持变更少，利于 CI 层缓存）---
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/web/package.json ./packages/web/
COPY packages/agents/pm/package.json ./packages/agents/pm/
COPY packages/agents/dev/package.json ./packages/agents/dev/
COPY packages/agents/ops/package.json ./packages/agents/ops/

RUN npm ci

# --- 源码层 ---
COPY packages ./packages
COPY config ./config
COPY migrations ./migrations

RUN npm run build -w @loop/shared \
 && npm run build -w @loop/agent-pm \
 && npm run build -w @loop/agent-dev \
 && npm run build -w @loop/agent-ops \
 && npm run build -w @loop/orchestrator

FROM harbor.qihoo.net/library/node:22.16.0-alpine AS runner

RUN apk add --no-cache git openssh-client ca-certificates bash

ENV SHELL=/bin/bash
WORKDIR /app
ENV NODE_ENV=production
ENV ORCHESTRATOR_PORT=3000

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/agents/pm/package.json ./packages/agents/pm/
COPY packages/agents/dev/package.json ./packages/agents/dev/
COPY packages/agents/ops/package.json ./packages/agents/ops/

RUN npm install --omit=dev

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
