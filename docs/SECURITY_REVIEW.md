# MediBook Security Architecture & OWASP Top 10 Review

This document provides a comprehensive security review of the rebuilt MediBook telehealth and EMS platform, mapping the OWASP Top 10 (2021) risks directly to our architectural controls, code implementations, and automated verification suites.

---

## OWASP Top 10 Mapping & Verification

### A01: Broken Access Control
- **Risk:** Patients accessing other patients' medical records, doctors viewing unassigned consultations, or users impersonating administrative roles.
- **Implementation & Mitigations:**
  - Role-Based Access Control (`RolesGuard` in `apps/api/src/modules/identity/guards/roles.guard.ts`) enforcing `PATIENT | DOCTOR | ADMIN | DRIVER`.
  - Scoped data access: Database queries filter by `user.id` or verified `appointment.patient_id` / `appointment.doctor_id`.
  - Room isolation in WebSockets (`ConsultationGateway` and `AmbulanceGateway`): users are verified against the specific appointment or emergency request before being allowed to join room `consult:<id>` or `ambulance:<id>`.
- **Proof Tests:**
  - `apps/api/test/rbac.spec.ts` (verifies access matrix across all 4 roles)
  - `apps/api/test/ambulance-socket-isolation.spec.ts` (verifies user B cannot join user A's ambulance telemetry stream)
  - `apps/api/test/non-participant-denied.spec.ts` (verifies non-participants cannot access video tokens or consultation chats)

---

### A02: Cryptographic Failures
- **Risk:** Plaintext credential exposure, weak hashing, leaked JWT secrets, unencrypted PHI in transit.
- **Implementation & Mitigations:**
  - Password hashing via **Argon2id** (`argon2.hash` with memoryCost=65536, timeCost=3, parallelism=4).
  - Short-lived Access JWTs (15 minutes).
  - Rotating Refresh Tokens: SHA-256 hashed in database, transmitted via `httpOnly`, `Secure`, `SameSite=Strict` cookies. If a revoked or reused refresh token is presented, theft detection invalidates the entire token family.
  - MinIO Presigned URLs with 15-minute TTL, restricted to verified MIME types (`application/pdf`, `image/jpeg`, `image/png`) and 10MB max size.
  - TLS encryption across all services; HTTPS and WSS enforced in Nginx.
- **Proof Tests:**
  - `apps/api/test/token-rotation.spec.ts` (verifies reuse detection and token family invalidation)
  - `apps/api/test/signed-url-scope.spec.ts` (verifies MIME type and size boundaries)

---

### A03: Injection (SQL, NoSQL, Command)
- **Risk:** SQL injection through doctor searches or financial transactions.
- **Implementation & Mitigations:**
  - **Prisma ORM** uses parameterized queries for all operations.
  - Raw SQL queries (e.g. `pg_trgm` similarity search and `FOR UPDATE SKIP LOCKED`) utilize strictly parameterized tagged template literals (`Prisma.sql` and `$queryRaw`).
  - Strict input validation via NestJS Zod validation pipes (`ZodValidationPipe`) rejecting unvalidated inputs before hitting controllers.
- **Proof Tests:**
  - `apps/api/test/env.spec.ts` and automated Zod pipe validation tests.

---

### A04: Insecure Design & Financial Concurrency
- **Risk:** Double-booking appointments, double-charging credit cards, claiming ambulances concurrently, orphan bookings.
- **Implementation & Mitigations:**
  - **Zero Double-Booking:** PostgreSQL partial unique index `UNIQUE(doctor_id, slot_time) WHERE status IN ('HELD', 'CONFIRMED', 'IN_PROGRESS')`.
  - **Double-Entry Ledger:** Integer paise financial transactions where `SUM(debits) === SUM(credits)` strictly maintained.
  - **Atomic Claims:** Ambulance accept uses atomic conditional updates (`updateMany` with `status: 'OFFERED'`), guaranteeing exactly 1 winning driver.
  - **Leave Cascade:** Doctor leaves trigger dry-run conflict evaluations and automated 100% refunds without silent orphan states.
- **Proof Tests:**
  - `apps/api/test/concurrency-booking.spec.ts` (50 parallel booking race)
  - `apps/api/test/concurrent-accept.spec.ts` (5 drivers concurrently accepting emergency request)
  - `apps/api/test/ledger-balance.spec.ts` (zero-sum ledger invariant validation)
  - `apps/api/test/same-webhook-replay.spec.ts` (10x webhook replay flood)

---

### A05: Security Misconfiguration
- **Risk:** Default credentials, debug endpoints exposed in production, missing security headers.
- **Implementation & Mitigations:**
  - Startup environment schema validation with Zod (`apps/api/src/config/env.schema.ts`), failing immediately on startup if secrets or required keys are missing.
  - Multi-stage Dockerfiles with non-root users (`USER nestjs -u 1001`, `USER nextjs -u 1001`, `USER appuser -u 1001`).
  - Production Nginx headers: Content-Security-Policy (CSP), X-Frame-Options (SAMEORIGIN), X-Content-Type-Options (nosniff), Referrer-Policy, Strict-Transport-Security (HSTS ready).

---

### A06: Vulnerable and Outdated Components
- **Risk:** Known CVEs in dependencies.
- **Implementation & Mitigations:**
  - Strict dependency pin via `pnpm-lock.yaml`.
  - Verified package provenance via `pnpm.onlyBuiltDependencies`.
  - Monorepo dependencies managed with automated build script approvals.

---

### A07: Identification and Authentication Failures
- **Risk:** Brute-force credential attacks, credential stuffing, session fixation.
- **Implementation & Mitigations:**
  - Redis-backed rate limiting on `/api/v1/auth/login` (throttled by IP and email).
  - Nginx rate-limiting zone: `zone=auth_limit:10m rate=5r/s burst=10 nodelay`.
  - Access token revocation lists and rotating refresh tokens.
- **Proof Tests:**
  - `apps/api/test/rate-limit.spec.ts` (verifies brute-force lockouts)

---

### A08: Software and Data Integrity Failures
- **Risk:** Spoofed payment webhooks, tampered prescriptions, modified clinical records.
- **Implementation & Mitigations:**
  - Payment Webhook Inbox: Raw body HMAC-SHA256 signature verification (`X-Razorpay-Signature`) before processing. Invalid signatures rejected with HTTP 400.
  - Immutable Prescriptions: Once an appointment is marked `COMPLETED`, prescriptions are versioned (`PrescriptionVersion`), digitally signed, and cannot be modified in place. Edits create new immutable version records.
- **Proof Tests:**
  - `apps/api/test/bad-signature.spec.ts` (tampered signatures rejected)
  - `apps/api/test/prescription-versioning.spec.ts` (immutable version lineage and audit)

---

### A09: Security Logging and Monitoring Failures
- **Risk:** Undetected data exfiltration, unlogged medical record reads (HIPAA / DISHA non-compliance).
- **Implementation & Mitigations:**
  - Pino structured JSON logging with correlation IDs (`x-request-id`) injected into every request and error context.
  - **Immutable Audit Logging Service:** All state-changing mutations and **PHI reads** (prescriptions, consultation chat transcripts) write audit entries to the database with user ID, IP address, and resource metadata.
  - Prometheus `/metrics` endpoint and Grafana dashboard alerting on booking conflicts, webhook lag, and auth failures.
- **Proof Tests:**
  - `apps/api/test/metrics.spec.ts` (Prometheus exposition)
  - Unit tests asserting `AuditService.logPhiRead` on prescription retrieval.

---

### A10: Server-Side Request Forgery (SSRF)
- **Risk:** AI service or webhook client making requests to arbitrary internal addresses.
- **Implementation & Mitigations:**
  - Outgoing HTTP clients (AI Gateway, Razorpay client) connect strictly to validated upstream URLs (`AI_SERVICE_URL`, `RAZORPAY_API_URL`).
  - Circuit breaker in AI Gateway rejects calls if latency exceeds timeouts or failures spike, with deterministic local fallback.
