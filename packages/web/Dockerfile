# AI Native Loop — Web UI (Next.js standalone)
# 构建上下文：仓库根目录
# docker build -f packages/web/Dockerfile -t loop-web .
#
# 构建参数（CI 中传入公网地址）:
#   --build-arg NEXT_PUBLIC_ORCHESTRATOR_URL=https://api.loop.example.com
#   --build-arg NEXT_PUBLIC_WS_URL=wss://ws.loop.example.com

FROM harbor.qihoo.net/library/node:22.16.0-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:3000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:3001

ENV NEXT_PUBLIC_ORCHESTRATOR_URL=$NEXT_PUBLIC_ORCHESTRATOR_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

COPY package.json ./
COPY packages/web/package.json ./packages/web/

RUN npm install

COPY packages/web ./packages/web

RUN mkdir -p packages/web/public

RUN npm run build -w @loop/web

FROM harbor.qihoo.net/library/node:22.16.0-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/packages/web/public ./packages/web/public
COPY --from=builder --chown=nextjs:nodejs /app/packages/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/web/.next/static ./packages/web/.next/static

USER nextjs

EXPOSE 3002

CMD ["node", "packages/web/server.js"]
