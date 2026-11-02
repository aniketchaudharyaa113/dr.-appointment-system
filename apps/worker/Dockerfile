FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@12.16.1

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json .npmrc ./
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker

RUN pnpm approve-builds --all && pnpm --filter @medibook/shared --filter @medibook/worker install --frozen-lockfile
RUN pnpm --filter @medibook/shared build
RUN pnpm --filter @medibook/worker build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g pnpm@12.16.1 && addgroup -g 1001 -S nodejs && adduser -S worker -u 1001

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc ./
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker/node_modules ./apps/worker/node_modules

USER worker

CMD ["node", "apps/worker/dist/main.js"]
