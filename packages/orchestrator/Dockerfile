# 已迁移到仓库根目录 Dockerfile，避免 CI 将本目录当作 build context 导致 COPY 失败。
#
# 请在仓库根目录执行：
#   docker build -f Dockerfile -t loop-orchestrator .
#
# 不要使用：
#   docker build -f packages/orchestrator/Dockerfile packages/orchestrator  ❌
#
# 若流水线只能写 Dockerfile 路径，请保持 context 为仓库根：
#   docker build -f packages/orchestrator/Dockerfile -t loop-orchestrator .
#   （注意最后一个参数是 . 不是 packages/orchestrator）

FROM harbor.qihoo.net/library/node:22.16.0-alpine AS builder

WORKDIR /app

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

RUN apk add --no-cache git openssh-client ca-certificates

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
