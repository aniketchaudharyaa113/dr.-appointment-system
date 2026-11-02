FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@12.16.1

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json .npmrc ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

RUN pnpm approve-builds --all && pnpm --filter @medibook/shared --filter @medibook/web install --frozen-lockfile
RUN pnpm --filter @medibook/shared build
RUN pnpm --filter @medibook/web build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web"]
