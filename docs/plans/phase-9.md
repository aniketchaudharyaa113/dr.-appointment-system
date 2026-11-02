# Phase 9 Plan: Observability, Hardening, Load Testing & Final Documentation

## Objectives
Complete production hardening, metrics instrumentation, k6 performance benchmarking, security reviews, and interview-ready architectural documentation.

## Deliverables
1. **Metrics & Observability**:
   - Prometheus metrics endpoint `/metrics` in `apps/api/src/modules/platform/metrics/` exposing:
     - `medibook_http_requests_total`
     - `medibook_booking_conflicts_total`
     - `medibook_payment_webhooks_processed_total`
     - `medibook_ambulance_dispatch_seconds`
     - `medibook_ledger_zero_sum_checks_total`
   - Grafana dashboard definition in `infra/grafana/dashboards/medibook.json`
2. **Production Hardening**:
   - Production Dockerfiles with multi-stage builds (`builder` -> `runner`), minimal distroless/alpine base, non-root user execution (`USER node` or `USER 1001`).
   - Production Nginx reverse-proxy configuration (`infra/nginx/nginx.conf`) with rate-limiting zones (`limit_req_zone`), strict CSP, X-Frame-Options, HSTS headers.
   - Security review document `docs/SECURITY_REVIEW.md` mapping OWASP Top 10 to our code.
3. **Load Testing & Resilience**:
   - `load/k6-booking-flow.js`: Concurrent booking flow (browse -> hold -> pay) testing Redis hold leases and zero double-booking under load.
   - `load/k6-webhook-flood.js`: Replaying identical webhooks concurrently to verify HMAC validation and exact-once ledger invariant.
   - Truthful execution report in `docs/LOAD_TEST.md`.
4. **Final System Design & Interview Guide**:
   - Update `README.md` with high-level architecture, 7-command demo guide, and seeded credentials.
   - Update `docs/SYSTEM_DESIGN.md` reflecting the actual codebase implementation.
   - Create `docs/INTERVIEW_GUIDE.md` addressing the 20 hardest system design & concurrency questions.
