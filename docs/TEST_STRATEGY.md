# MediBook Test Strategy & Quality Assurance Framework

## 1. Test Pyramid & Philosophy

MediBook adheres to a disciplined, multi-tiered test pyramid designed to catch regressions early, verify concurrency invariants under heavy parallel load, and ensure critical clinical/payment flows never fail in production.

```
                  ┌─────────────────┐
                  │  End-to-End     │   5% - Playwright E2E
                  │  (User Flows)   │   (Axe a11y, Browser Journeys)
                  ├─────────────────┤
                  │  Integration    │   25% - Vitest / Supertest
                  │  & Concurrency  │   (Testcontainers Postgres, Redis, MinIO)
                  ├─────────────────┤
                  │  Unit Tests     │   70% - Vitest / Jest
                  │  (Domain Logic) │   (State machines, Zod schemas, ledger, fees)
                  └─────────────────┘
```

---

## 2. Testing Levels & Scope

### 2.1 Unit Tests (70%)
- **Target**: Pure functions, mathematical calculations, domain state machines, validation pipes, and utility classes.
- **Speed**: < 5 milliseconds per test; completely isolated with zero external network or database dependencies.
- **Coverage Highlights**:
  - Payment fee and platform commission splits (paise math).
  - Double-entry ledger debit/credit balancing assertions.
  - Appointment and payment state machine transition rules.
  - Doctor slot time grid alignment and timezone offsets (`Asia/Kolkata`).
  - Rule-based emergency keyword detector and triage classifier scoring.
  - Haversine distance and dynamic vehicle ETA algorithms.

### 2.2 Integration Tests (25%)
- **Target**: NestJS controllers, services, database queries, Redis distributed locks, BullMQ workers, and external provider adapters.
- **Execution**: Run with **Testcontainers** spawning real, clean instances of PostgreSQL 16 (with pgvector and pg_trgm extensions) and Redis 7.
- **Coverage Highlights**:
  - **Concurrency Suite**: 50 simultaneous parallel booking requests competing for a single slot, asserting exactly 1 success (201) and 49 conflicts (409).
  - **Payment Webhook Flood**: 10 simultaneous replays of the identical Razorpay webhook, verifying idempotency and single ledger posting.
  - **Late Payment Auto-Refund**: Verifying automated refund execution when a webhook arrives after a slot has expired and been rebooked.
  - **Outbox Relay**: Verifying atomic persistence of domain events and subsequent dispatch by background worker.
  - **Ambulance Atomic Claim**: Parallel driver acceptance race ensuring only one driver claims a dispatch.
  - **Socket Isolation**: Proving that WebSocket events emitted in room A are strictly isolated from client in room B.

### 2.3 End-to-End (E2E) Browser Tests (5%)
- **Target**: Complete cross-system user journeys running against the full stack in a live browser environment.
- **Tool**: **Playwright** with automated Axe accessibility auditing.
- **Scenarios**:
  1. **Complete Patient Journey**: User signup → Search doctor by symptom ("chest pain") → Select slot → Hold countdown verification → Checkout with Fake Razorpay provider → Confirmation page with booking ref `MB-YYYYMMDD-NNN`.
  2. **Teleconsultation Flow**: Patient enters waiting room → Doctor admits patient → LiveKit video connection establishes → Chat message with attachment sent → Doctor completes consultation → Prescription PDF verified and downloaded.
  3. **Emergency Ambulance Flow**: Patient triggers SOS from mobile viewport → Location acquired → Driver accepts dispatch → Real-time vehicle pin movement on Leaflet map verified.
  4. **Admin Verification Flow**: Admin reviews pending doctor profile → Approves license → Doctor appears in public search results.
  5. **WCAG 2.2 AA Accessibility Audit**: Automated `axe-core` scan of all key pages asserting zero critical or serious accessibility violations.

---

## 3. Tooling & Environment Orchestration

### 3.1 Testcontainers
Testcontainers manages ephemeral, disposable Docker containers during integration test runs.
- **PostgreSQL 16**: Configured with `pgvector/pgvector:pg16` image, automatically applying all database migrations prior to test execution.
- **Redis 7**: Configured with `redis:7-alpine`, ensuring clean in-memory state, keyspace isolation, and GEO index support between test suites.
- **MinIO**: Used to verify pre-signed upload URL generation, multi-part uploads, and file access policies.

### 3.2 Provider Abstraction in Tests
- **Payments**: The `FakePaymentProvider` simulates all gateway behaviors without internet connectivity:
  - Immediate payment capture.
  - Simulated payment failure.
  - Delayed webhook delivery.
  - Duplicate webhook bursts.
  - Automated refund callbacks.
- **Video / LiveKit**: Mock token validator and mock SFU room participant fixture to verify room authorization and join-window logic without spinning up external media tracks.
- **AI Service**: Deterministic Mock LLM fixture providing instant, reproducible completions for CI/CD test runs.

---

## 4. Quality Gates & Continuous Integration (CI)

Every commit and pull request must clear the strict verification gate before merging:

```bash
# Verification Pipeline
pnpm lint           # ESLint strict rules + module boundaries check
pnpm typecheck      # TypeScript --noEmit across all workspaces
pnpm test           # Unit & Integration tests across all modules
pnpm test:e2e       # Headless Playwright tests + Axe a11y checks
pnpm build          # Turborepo build of api, worker, web, and shared
```

Any regression, type mismatch, broken invariant, or failed accessibility standard terminates the build immediately.
