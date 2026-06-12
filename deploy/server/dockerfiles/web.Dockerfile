# 单机部署用 Web 镜像
# 构建 context：仓库根目录

ARG NODE_IMAGE=node:22-alpine
ARG NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:3000
ARG NEXT_PUBLIC_WS_URL=ws://localhost:3001

FROM ${NODE_IMAGE} AS builder

WORKDIR /app

ARG NEXT_PUBLIC_ORCHESTRATOR_URL
ARG NEXT_PUBLIC_WS_URL

ENV NEXT_PUBLIC_ORCHESTRATOR_URL=$NEXT_PUBLIC_ORCHESTRATOR_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

COPY package.json package-lock.json ./
COPY packages/web/package.json ./packages/web/

RUN npm ci

COPY packages/web ./packages/web

RUN mkdir -p packages/web/public && npm run build -w @loop/web

FROM ${NODE_IMAGE} AS runner

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
