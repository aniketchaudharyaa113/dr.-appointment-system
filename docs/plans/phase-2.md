# Phase 2 Execution Plan: Identity and Security

## 1. Objectives
Implement production-grade authentication and authorization with short-lived access JWTs (15m), rotating hashed refresh tokens stored in secure httpOnly cookies, Argon2id password hashing, RBAC guards (`PATIENT | DOCTOR | ADMIN | DRIVER`), Redis-backed rate limiting, admin doctor verification with audit logs, and PHI read auditing.

---

## 2. Modules and Files to Create
1. **Identity Module** (`apps/api/src/modules/identity/`):
   - `identity.module.ts`
   - `auth.controller.ts`: `/api/auth/register`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/me`
   - `auth.service.ts`: Argon2id hashing, token minting, token rotation with reuse detection
   - `guards/jwt-auth.guard.ts`: Extracts Bearer JWT or cookie, verifies payload
   - `guards/roles.guard.ts`: Enforces RBAC roles metadata
   - `decorators/roles.decorator.ts` and `decorators/current-user.decorator.ts`
   - `rate-limit/rate-limit.guard.ts`: Redis sliding window rate limiter (IP + email)
2. **Audit Module** (`apps/api/src/modules/platform/audit/`):
   - `audit.service.ts`: Records mutations and PHI access logs to `audit_logs` table
   - `interceptors/audit-read.interceptor.ts`: Audits reads of sensitive medical records
3. **Admin Verification Module** (`apps/api/src/modules/admin/`):
   - `admin.controller.ts`: `/api/admin/doctors/pending`, `/api/admin/doctors/:id/verify`
   - `admin.service.ts`: Transitions doctor `verificationStatus` (`APPROVED` / `REJECTED`) with audit trail
4. **Database Seeding**:
   - `apps/api/prisma/seed.ts`: Seeds default Admin, verified Doctors, Patients, and Drivers

---

## 3. Risks & Mitigations
- **Refresh Token Theft & Replay**: Attacker steals refresh token.
  *Mitigation: Store hashed refresh token in DB. When a token is used, rotate it immediately and issue a new pair. If an already-used/revoked refresh token is presented, revoke all refresh tokens for that user (token family revocation) and log a security alert.*
- **Brute Force on Login**: Credential stuffing attacks.
  *Mitigation: Redis-backed sliding window rate limit (5 attempts per minute per IP + email).*
- **PHI Leakage on Reads**: Medical records inspected without audit.
  *Mitigation: `AuditService` records actor, target patient, timestamp, and IP address for all prescription and consultation reads.*

---

## 4. Tests to Write
1. `apps/api/test/auth.spec.ts`:
   - Password hashing and verification with Argon2id.
   - Successful login returns 15m access token and sets httpOnly refresh cookie.
   - Token rotation: Refreshing token returns new access token and new refresh token.
   - Reuse detection: Replaying old refresh token invalidates all sessions for that user.
2. `apps/api/test/rbac.spec.ts`:
   - Patient accessing Doctor or Admin endpoint receives 403 Forbidden.
   - Doctor accessing Admin verification receives 403 Forbidden.
   - Admin can access protected admin endpoints.
3. `apps/api/test/rate-limit.spec.ts`:
   - 6th consecutive login attempt within 1 minute is blocked with 429 Too Many Requests.
