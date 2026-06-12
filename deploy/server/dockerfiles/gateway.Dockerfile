# 单机部署用 Gateway 镜像
# 构建 context：仓库根目录

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/gateway/package.json ./packages/gateway/

RUN npm ci

COPY packages/shared ./packages/shared
COPY packages/gateway ./packages/gateway

RUN npm run build -w @loop/shared && npm run build -w @loop/gateway

FROM ${NODE_IMAGE} AS runner

RUN apk add --no-cache wget

WORKDIR /app

ENV NODE_ENV=production
ENV WS_PORT=3001
ENV ORCHESTRATOR_URL=http://orchestrator:3000

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/gateway/package.json ./packages/gateway/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/gateway/dist ./packages/gateway/dist

WORKDIR /app/packages/gateway

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/main.js"]
