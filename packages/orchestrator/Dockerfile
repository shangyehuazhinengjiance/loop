# AI Native Loop — Orchestrator
# 构建上下文：仓库根目录
# docker build -f packages/orchestrator/Dockerfile -t loop-orchestrator .

FROM harbor.qihoo.net/library/node:22.16.0-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/agents/pm/package.json ./packages/agents/pm/
COPY packages/agents/dev/package.json ./packages/agents/dev/
COPY packages/agents/ops/package.json ./packages/agents/ops/

RUN npm install

COPY packages/shared ./packages/shared
COPY packages/orchestrator ./packages/orchestrator
COPY packages/agents/pm ./packages/agents/pm
COPY packages/agents/dev ./packages/agents/dev
COPY packages/agents/ops ./packages/agents/ops
COPY config ./config
COPY migrations ./migrations

RUN npm run build -w @loop/shared \
 && npm run build -w @loop/agent-pm \
 && npm run build -w @loop/agent-dev \
 && npm run build -w @loop/agent-ops \
 && npm run build -w @loop/orchestrator

# ── 生产镜像 ─────────────────────────────────────────────
FROM harbor.qihoo.net/library/node:22.16.0-alpine AS runner

RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV ORCHESTRATOR_PORT=3000

# 仅安装生产依赖（workspace 子包）
COPY package.json ./
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

# 数据库迁移（CI 中可覆盖）: node dist/db/migrate.js
CMD ["node", "dist/main.js"]
