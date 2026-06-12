# 单机部署用 Orchestrator 镜像（不依赖公司 Harbor 基础镜像）
# 构建 context：仓库根目录
#   docker build -f deploy/server/dockerfiles/orchestrator.Dockerfile -t loop-orchestrator:local .

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/agents/pm/package.json ./packages/agents/pm/
COPY packages/agents/dev/package.json ./packages/agents/dev/
COPY packages/agents/ops/package.json ./packages/agents/ops/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/web/package.json ./packages/web/

RUN npm ci

COPY packages ./packages
COPY config ./config
COPY migrations ./migrations

RUN npm run build -w @loop/shared \
 && npm run build -w @loop/agent-pm \
 && npm run build -w @loop/agent-dev \
 && npm run build -w @loop/agent-ops \
 && npm run build -w @loop/orchestrator

FROM ${NODE_IMAGE} AS runner

RUN apk add --no-cache git openssh-client ca-certificates bash wget

WORKDIR /app

ENV NODE_ENV=production
ENV ORCHESTRATOR_PORT=3000

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/agents/pm/package.json ./packages/agents/pm/
COPY packages/agents/dev/package.json ./packages/agents/dev/
COPY packages/agents/ops/package.json ./packages/agents/ops/

RUN npm ci --omit=dev

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
