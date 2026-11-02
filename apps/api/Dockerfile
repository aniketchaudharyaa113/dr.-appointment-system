FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@12.16.1

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json .npmrc ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN pnpm approve-builds --all && pnpm --filter @medibook/shared --filter @medibook/api install --frozen-lockfile
RUN pnpm --filter @medibook/shared build
RUN cd apps/api && npx prisma generate && pnpm build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g pnpm@12.16.1 && addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001

COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/.npmrc ./
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules

USER nestjs

EXPOSE 4000

CMD ["sh", "-c", "cd apps/api && npx prisma migrate deploy && node dist/main.js"]
