# AI Native Loop — WebSocket Gateway
# 构建上下文：仓库根目录
# docker build -f packages/gateway/Dockerfile -t loop-gateway .

FROM harbor.qihoo.net/library/node:22.16.0-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/gateway/package.json ./packages/gateway/

RUN npm install

COPY packages/shared ./packages/shared
COPY packages/gateway ./packages/gateway

RUN npm run build -w @loop/shared \
 && npm run build -w @loop/gateway

FROM harbor.qihoo.net/library/node:22.16.0-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV WS_PORT=3001
# K8s 内通过 Service 名访问，部署时覆盖
ENV ORCHESTRATOR_URL=http://loop-orchestrator:3000

COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/gateway/package.json ./packages/gateway/

RUN npm install --omit=dev

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/gateway/dist ./packages/gateway/dist

WORKDIR /app/packages/gateway

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

CMD ["node", "dist/main.js"]
