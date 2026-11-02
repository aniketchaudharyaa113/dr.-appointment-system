# Phase 1 Execution Plan: Foundation

## 1. Objectives
Establish a clean, scalable monorepo structure using pnpm workspaces and Turborepo. Spin up the underlying containerized infrastructure (PostgreSQL 16 with pgvector & pg_trgm, Redis 7, MinIO, Mailpit, LiveKit) via Docker Compose. Implement NestJS with Fastify adapter, structured Pino logging, request IDs, strict Zod environment validation, Prisma schema with hand-written SQL migrations, health endpoints (`/health/live`, `/health/ready`), OpenAPI documentation, and a working integration test using Testcontainers.

---

## 2. Directory & Workspace Structure
```
├── package.json (root monorepo config)
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .gitignore
├── .env.example
├── docker-compose.yml
├── docker-compose.observability.yml
├── apps/
│   ├── api/ (NestJS Fastify modular monolith)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/ (filters, pipes, interceptors, logger, config)
│   │   │   ├── modules/
│   │   │   │   ├── platform/ (database, health, redis, outbox)
│   │   │   │   └── ...
│   │   └── test/
│   ├── worker/ (NestJS standalone BullMQ worker)
│   │   ├── package.json
│   │   └── src/
│   └── web/ (Next.js 15 App Router)
│       ├── package.json
│       └── ...
├── services/
│   └── ai/ (Python FastAPI service)
│       ├── pyproject.toml
│       ├── main.py
│       └── ...
├── packages/
│   └── shared/ (Shared zod schemas, types, constants)
│       ├── package.json
│       └── src/
└── infra/ (Nginx, Prometheus, Grafana configs)
```

---

## 3. Files to Create
1. Root configuration:
   - `pnpm-workspace.yaml`
   - `turbo.json`
   - `package.json`
   - `tsconfig.base.json`
   - `.env.example`
   - `docker-compose.yml`
2. Shared Package (`packages/shared`):
   - `package.json`, `tsconfig.json`, `src/index.ts`, `src/types/index.ts`, `src/schemas/index.ts`
3. API Application (`apps/api`):
   - `package.json`, `tsconfig.json`, `nest-cli.json`
   - `prisma/schema.prisma`
   - `prisma/migrations/0_init/migration.sql` (baseline SQL with extensions and partial indexes)
   - `src/main.ts` (Fastify adapter, Swagger OpenAPI setup, Zod validation pipe, global error filter)
   - `src/app.module.ts`
   - `src/common/config/env.schema.ts` (strict runtime Zod validation)
   - `src/common/logger/pino-logger.service.ts` (request ID tracing & PHI redaction)
   - `src/common/filters/http-exception.filter.ts`
   - `src/modules/platform/health/health.controller.ts` (`/health/live`, `/health/ready`)
   - `src/modules/platform/database/prisma.service.ts`
   - `src/modules/platform/redis/redis.service.ts`
4. Test Harness:
   - `apps/api/test/health.integration.spec.ts` (Testcontainers PostgreSQL + Redis verification)

---

## 4. Database Migrations
- Extension initialization: `pgcrypto`, `pg_trgm`, `vector`.
- Core baseline schema:
  - `users`, `refresh_tokens`, `audit_logs`
  - `doctors`, `availability`, `doctor_leaves`, `doctor_daily_counters`
  - `appointments` with partial unique index `(doctor_id, slot_time) WHERE status IN ('PENDING_PAYMENT', 'CONFIRMED')`
  - `payments`, `payment_events`, `refunds`, `ledger_entries`
  - `consultation_sessions`, `prescriptions`, `prescription_versions`
  - `waitlists`, `ambulance_requests`, `outbox_events`

---

## 5. Potential Risks & Mitigations
- **Port Conflicts**: Port 5432 might conflict with existing local postgres container. *Mitigation: Map host port 5434 to container 5432 in docker-compose, or allow configurable DB_PORT.*
- **Fastify vs Express middleware differences**: NestJS with Fastify requires specific plugins for cookies, raw body, and CORS. *Mitigation: Use `@fastify/cookie`, `@fastify/cors`, and `@fastify/helmet` with correct Fastify hooks.*
- **Testcontainers Docker Socket**: Testcontainers needs access to the local Docker socket. *Mitigation: Verify Docker daemon connection and fallback gracefully if environment has specific socket paths.*

---

## 6. Verification Test List
1. `apps/api/test/env.spec.ts`: Asserts startup fails gracefully with informative errors if required env variables are missing or malformed.
2. `apps/api/test/health.integration.spec.ts`:
   - `GET /health/live`: Returns 200 `{ status: "ok" }`.
   - `GET /health/ready`: Checks DB connection and Redis ping, returning 200 `{ status: "ok", db: true, redis: true }`.
3. `pnpm lint && pnpm typecheck && pnpm test && pnpm build`: Monorepo build and lint must cleanly pass across all workspaces.
