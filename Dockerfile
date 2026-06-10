# AI Native Loop — Orchestrator（请在仓库根目录构建）
#
#   docker build -f Dockerfile -t loop-orchestrator .
#                                 最后一个参数必须是 .
#
# 若报错 packages/shared/package.json not found，
# 说明 CI 的 build context 不是仓库根目录，请改 Jenkinsfile（见仓库根 Jenkinsfile）。

FROM harbor.qihoo.net/library/node:22.16.0-alpine AS builder

WORKDIR /app

# 校验 build context（缺少则说明 context 不是仓库根目录）
COPY packages/shared/package.json ./packages/shared/package.json

COPY package.json ./
COPY packages ./packages
COPY config ./config
COPY migrations ./migrations

RUN npm install

RUN npm run build -w @loop/shared \
 && npm run build -w @loop/agent-pm \
 && npm run build -w @loop/agent-dev \
 && npm run build -w @loop/agent-ops \
 && npm run build -w @loop/orchestrator

FROM harbor.qihoo.net/library/node:22.16.0-alpine AS runner

# Claude Agent SDK 的 Bash 工具需要 POSIX shell（Alpine 默认仅 sh）
RUN apk add --no-cache git openssh-client ca-certificates bash

ENV SHELL=/bin/bash

WORKDIR /app

ENV NODE_ENV=production
ENV ORCHESTRATOR_PORT=3000

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

CMD ["node", "dist/main.js"]
