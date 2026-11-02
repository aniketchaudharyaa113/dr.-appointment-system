# MediBook Technical System Design & Interview Guide

This guide breaks down every core architectural decision in MediBook and provides rigorous, in-depth answers to the **20 hardest questions an engineering interviewer would ask** about this platform.

---

## Part 1: Core Architectural Decisions & Rationale

1. **Modular Monolith over Microservices**:
   - *Decision:* Build a single deployable NestJS modular monolith with strict domain boundaries enforced via TypeScript and directory boundaries, with transactional outbox relay to worker.
   - *Rationale:* Eliminates distributed transaction overhead (2PC/Saga complexity), network serialization latency, and operational burden while preserving clean domain separation. Only the Python AI service is extracted due to specialized ML runtime requirements.

2. **Integer Paise Financial Ledger**:
   - *Decision:* All monetary values stored as 64-bit integer paise (1 INR = 100 paise).
   - *Rationale:* Floating-point math introduces rounding errors (e.g., `0.1 + 0.2 !== 0.3`). Double-entry ledger invariant `SUM(debits) === SUM(credits)` must hold to the exact single paisa.

3. **Zero Double-Booking via PostgreSQL Partial Unique Index**:
   - *Decision:* `CREATE UNIQUE INDEX unique_active_slot ON appointments(doctor_id, slot_time) WHERE status IN ('HELD', 'CONFIRMED', 'IN_PROGRESS');`
   - *Rationale:* Database-level physical constraint eliminates any possibility of double-booking, even under extreme parallel application server concurrency or Redis failure. Cancelled appointments release the slot immediately.

4. **Transactional Outbox Pattern**:
   - *Decision:* Domain events written in the same DB transaction as the business entity mutation, relayed asynchronously by BullMQ workers to external consumers.
   - *Rationale:* Dual-write problem: writing to a DB and publishing to Kafka/RabbitMQ/Redis can fail halfway, causing silent data drift. Outbox guarantees at-least-once delivery without distributed locks.

5. **Clinical RAG over LLM Fine-Tuning**:
   - *Decision:* Curated clinical retrieval-augmented generation using PostgreSQL `pgvector` + `pg_trgm` hybrid search instead of model fine-tuning.
   - *Rationale:* Medical knowledge, schedules, and clinical protocols update in real time; fine-tuned models suffer from catastrophic forgetting, unverified hallucinations, and impossible provenance tracking. RAG guarantees exact citation chips (`[1]`, `[2]`) required by India Telemedicine Practice Guidelines.

---

## Part 2: The 20 Hardest Interview Questions & Answers

### 1. How do you guarantee zero double-booking under extreme concurrency across multiple API replicas?
**Answer:**
We implement a multi-layered defense:
1. **Pessimistic Hold Layer (Redis):** A client acquiring a slot first executes `SET slot:{doctorId}:{slotTime} {patientId} NX PX 600000` (10-minute hold lease). If the key already exists, Redis rejects the request in sub-millisecond time.
2. **Authoritative Persistence Layer (PostgreSQL Partial Index):** In the database, the `appointments` table enforces a partial unique constraint:
   ```sql
   CREATE UNIQUE INDEX idx_doctor_active_slot 
   ON appointments (doctor_id, slot_time) 
   WHERE status IN ('HELD', 'CONFIRMED', 'IN_PROGRESS');
   ```
   If two requests race past the application layer simultaneously, PostgreSQL's WAL serialization forces one transaction to commit and immediately throws a unique constraint violation (`23505`) on the second. The losing request is rolled back and returns HTTP 409 Conflict. Cancelled slots (`CANCELLED`) do not match the `WHERE` clause, making them immediately re-bookable.

---

### 2. How do you handle a payment webhook arriving AFTER a slot hold lease has expired and the slot was taken by someone else?
**Answer:**
This is the classic "late payment after lease lapse" race condition.
1. When the payment gateway webhook (`payment.captured`) arrives, the worker opens a database transaction and executes `SELECT * FROM appointments WHERE id = $1 FOR UPDATE`.
2. It evaluates the appointment status:
   - If `status === 'HELD'` and current timestamp `<= hold_expires_at`, it confirms the appointment and transitions status to `CONFIRMED`.
   - If the hold expired and the doctor slot was already booked by another patient, confirming the appointment would violate our zero double-booking invariant.
3. Therefore, the worker transitions the appointment to `EXPIRED_SLOT_LOST`, records the capture in the ledger, and **immediately dispatches an automated 100% refund command** to the payment gateway via the transactional outbox. The patient is instantly notified via SMS/email with a full refund reference. Under no circumstance is the slot double-booked.

---

### 3. Why did you implement a double-entry ledger instead of simply updating an `account_balance` column?
**Answer:**
Updating a mutable `balance = balance + X` column is susceptible to concurrency races, lost updates, and provides zero auditability into financial discrepancies.
In our double-entry ledger:
- Every financial event creates immutable `ledger_entries` with matching debits and credits.
- For a ₹1,000 consultation with a ₹50 platform fee and 18% GST (₹171):
  - Debit: Patient Receivable (`122100` paise)
  - Credit: Doctor Payable (`100000` paise)
  - Credit: Platform Revenue (`5000` paise)
  - Credit: GST Tax Payable (`17100` paise)
- The invariant `SUM(debits) - SUM(credits) === 0` is verified at the transaction level. If a discrepancy arises, we have an immutable chronological ledger of every single paisa.

---

### 4. How do you ensure idempotent payment webhook processing when the gateway replays events 10 times?
**Answer:**
Payment gateways (Razorpay/Stripe) retry webhooks upon timeouts or network latency.
1. All incoming webhook payloads are immediately validated with raw HMAC-SHA256 signature verification (`X-Razorpay-Signature`).
2. We insert the event into a `payment_events` inbox table with a physical unique constraint on `provider_event_id`.
3. If the insert succeeds, we return HTTP 200 OK immediately and enqueue processing to BullMQ.
4. If a duplicate event arrives, the unique constraint throws `23505`, which our controller catches and returns HTTP 200 OK as a fast idempotent no-op without re-processing.
5. In the worker processor, the payment state machine enforces that a payment cannot transition from `CAPTURED` to `CAPTURED`, preventing duplicate ledger postings.

---

### 5. Why did you choose Fastify over Express for the NestJS API?
**Answer:**
Fastify provides:
- **Throughput:** ~2.5x higher requests per second compared to Express due to its custom `find-my-way` Radix tree router and `fast-json-stringify` schema compiler.
- **Lower Garbage Collection Pressure:** Fastify reuses request/response wrappers, significantly reducing GC pauses under high-throughput telehealth traffic.
- **Built-in Schema Validation:** Native integration with JSON schema validation and structured logging via Pino.

---

### 6. How do you prevent unauthorized eavesdropping on WebSocket streams?
**Answer:**
1. **Handshake Authentication:** The Socket.IO connection handshake requires a valid Bearer JWT. Unauthenticated connections are terminated at handshake.
2. **Room Access Verification:** When a socket emits `join_room` for `consult:<appointmentId>` or `ambulance:<requestId>`, the gateway does not trust client parameters. It queries the database using `PrismaService` to verify that `socket.user.id` is strictly equal to either `appointment.patient_id` or `appointment.doctor_id`.
3. If an unauthorized client attempts to join, a warning is logged, the request is rejected, and an audit security event is triggered. User B can never listen to User A's consultation or GPS coordinates.

---

### 7. How does the ambulance dispatch state machine guarantee that exactly ONE driver claims a request?
**Answer:**
When an emergency is triggered, it is offered to the nearest available driver with a 20-second timeout. If multiple drivers click "Accept" simultaneously:
We execute an atomic conditional database update:
```sql
UPDATE ambulance_requests 
SET status = 'ACCEPTED', driver_id = $driverId, updated_at = NOW() 
WHERE id = $requestId AND status = 'OFFERED';
```
In PostgreSQL, row-level locking on the `UPDATE` statement ensures that only the first driver's transaction updates the row (`count === 1`). The second driver's query finds `status === 'ACCEPTED'` (no longer `'OFFERED'`), returning `count === 0`. The losing driver immediately receives an error: *"Request already accepted by another driver"*, guaranteeing a single winner.

---

### 8. How do you handle driver telemetry at scale without overwhelming PostgreSQL?
**Answer:**
Driver GPS coordinates are streamed at 1.0 Hz. Writing this directly to relational disk would cause write amplification and bloated indexes.
Instead:
1. High-frequency coordinates are written to **Redis GEO** via `GEOADD ambulance:drivers:geo <lng> <lat> <driverId>`.
2. A companion Redis key `driver:heartbeat:<driverId>` with a 30-second TTL tracks liveness. If a driver loses connectivity or closes the app, the TTL expires, and they are automatically excluded from `GEORADIUS` dispatch searches.
3. Only lifecycle state transitions (`REQUESTED -> ACCEPTED -> EN_ROUTE -> ARRIVED`) are persisted to PostgreSQL.

---

### 9. Why not fine-tune a model like LLaMA-3 or Mistral for medical diagnosis?
**Answer:**
Fine-tuning for diagnosis introduces major clinical and legal liabilities:
1. **Hallucination Risk:** Fine-tuned weights can hallucinate plausible-sounding but lethal dosages or contraindications with no verifiable provenance.
2. **Static Knowledge:** Medical protocols, doctor availability, and pricing change weekly; retraining weights is cost-prohibitive.
3. **Regulatory Non-Compliance:** India's Telemedicine Practice Guidelines require clinical accountability. RAG allows deterministic filtering, source citations (`[1]`, `[2]`), and a hard safety triage layer that bypasses the model entirely when life-threatening symptoms are detected.

---

### 10. How does the Emergency Triage Classifier work, and why does it run before the LLM?
**Answer:**
LLM inference takes 800ms–2000ms and can fail or be throttled. In an emergency (e.g., acute myocardial infarction, severe hemorrhage, respiratory arrest), every second matters.
Our emergency detector:
- Runs in < 2ms locally using deterministic tokenized regexes and a multi-condition heuristic classifier.
- If an emergency presentation is detected, it **short-circuits and bypasses the generative model entirely**, instantly returning a Level 1 Emergency Card with click-to-call 112 and immediate ambulance dispatch buttons.
- Target recall is 100% on life-threatening presentations.

---

### 11. How do you prevent timezone drift between doctor clinics and remote patients?
**Answer:**
MediBook operates on wall-clock appointment slots in the clinic's local timezone (`Asia/Kolkata` / IST).
- Storing naive UTC timestamps causes drift when recurring weekly availability rules (e.g., "Monday 9:00 AM") interact with daylight saving time changes or client timezone conversions.
- All slot generation grids compute naive wall-clock time strings formatted in ISO-8601 with explicit offset: `2026-11-02T17:30:00+05:30`.
- The database columns store `TIMESTAMPTZ` with the clinic timezone explicitly set as a configuration parameter.

---

### 12. How does the transactional outbox pattern work in your worker service?
**Answer:**
1. During any business mutation (e.g., `PaymentService.confirmAppointment`), the business entities and an `outbox_events` record are inserted in the **same atomic database transaction**.
2. If the transaction commits, the event is physically guaranteed to exist in the database.
3. A lightweight BullMQ polling relay reads unhandled outbox events using `SELECT * FROM outbox_events WHERE processed_at IS NULL ORDER BY created_at ASC LIMIT 50 FOR UPDATE SKIP LOCKED`.
4. The worker delivers the event (sends email via Mailpit, pushes socket event, or updates metrics) and marks `processed_at = NOW()`.
5. If the worker crashes mid-delivery, the lock releases, and another worker retries. Consumers use the event's `idempotency_key` to prevent duplicate processing.

---

### 13. How do you protect patient Protected Health Information (PHI) in compliance with DISHA and HIPAA?
**Answer:**
1. **Zero PHI in Logs:** Pino logger uses automated serializers to scrub and redact sensitive fields (`email`, `phone`, `password`, `aadhaar`, `symptoms`, `prescription_text`).
2. **Access Control:** Doctors can only read prescriptions for patients with whom they have an active or completed consultation session.
3. **Immutable PHI Read Audit Trail:** Every retrieval of a medical prescription or consultation chat transcript writes an entry to `audit_logs` recording `actor_id`, `patient_id`, `resource_id`, `timestamp`, and `ip_address`.
4. **Encryption at Rest & in Transit:** Presigned MinIO URLs expire after 15 minutes and require valid authentication tokens.

---

### 14. What happens when a doctor updates their recurring availability or takes emergency leave?
**Answer:**
Silently deleting or orphaning existing bookings when availability changes is a severe defect.
In MediBook:
1. When a doctor requests leave or adjusts availability, the backend runs a **dry-run conflict analysis** counting affected booked slots.
2. Upon confirmation, a **cascading cancellation workflow** is executed in a transaction:
   - All active bookings in that time window are marked `CANCELLED_BY_DOCTOR`.
   - The slot hold unique locks are released.
   - 100% automatic refunds are queued through the outbox.
   - Priority notifications are dispatched to all affected patients with 1-click rebooking links to other doctors in the same specialty.

---

### 15. How does the waitlist offer chain work without race conditions?
**Answer:**
When a confirmed or held appointment is cancelled:
1. The system checks `appointment_waitlists` for users waiting for that doctor and date.
2. It selects the earliest waiting user in FIFO order and sets `status = 'OFFERED'` with a strict `offer_expires_at = NOW() + INTERVAL '15 minutes'`.
3. An outbox notification invites the patient to claim the slot.
4. If the patient claims it within 15 minutes, it transitions to `HELD`.
5. If the 15-minute lease expires without claim, a scheduled BullMQ job transitions the entry to `EXPIRED` and automatically offers the slot to the next user in line.

---

### 16. How do you prevent memory leaks and handle high concurrent WebSocket connections in NestJS?
**Answer:**
1. **Redis Adapter (`@socket.io/redis-adapter`):** Socket instances do not store cross-server state in Node.js process memory. Socket messages are routed across multiple API replicas via Redis pub/sub.
2. **Explicit Cleanup:** On client disconnect, event listeners and heartbeat intervals are cleared immediately.
3. **Rate Limiting:** Socket connections are throttled per IP in Nginx (`limit_conn addr_conn 50`).

---

### 17. How do you enforce modular monolith boundaries in code without microservice network latency?
**Answer:**
1. Modules in `apps/api/src/modules/` (`identity`, `scheduling`, `payments`, `consultation`, `ambulance`, `notifications`, `ai-gateway`) export strictly typed public services.
2. **No module imports Prisma models or queries database tables owned by another module.** For example, the `scheduling` module never writes to `payments` tables directly; it emits a domain event or calls `PaymentService`.
3. Architecture boundary linters (`dependency-cruiser` / ESLint boundaries) run in CI to fail the build if cross-boundary private imports are introduced.

---

### 18. Why do you use LiveKit for video consultations instead of WebRTC mesh or Agora?
**Answer:**
- **Peer-to-Peer WebRTC Mesh:** Fails when connections have asymmetric NATs, requires high client CPU/bandwidth for >2 participants, and provides no server-side token minting or recording controls.
- **Proprietary SaaS (Agora/Twilio):** Expensive, vendor lock-in, and transmits sensitive patient video through third-party servers.
- **LiveKit (Self-Hosted SFU):** Open-source, high-performance Go SFU deployable in our private Docker compose / Kubernetes cluster. The backend mints short-lived JWT tokens strictly inside the appointment join window (`[slotTime - 10m, slotTime + 30m]`), ensuring zero unauthorized video access.

---

### 19. How do you handle database migrations with zero downtime?
**Answer:**
We use the **Expand and Contract (Parallel Run)** migration pattern:
1. **Expand:** Add new nullable columns or tables (e.g., adding `paise` column alongside legacy fields).
2. **Write Both:** Application writes to both old and new columns.
3. **Backfill:** Asynchronous script backfills historical records in batches.
4. **Contract:** Remove reads from old column, drop old column in a subsequent release.
Hand-written SQL migrations handle partial indexes and extensions (`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`).

---

### 20. If you had to scale this platform to 10 million daily active users across India, what would you re-architect?
**Answer:**
1. **Database Sharding:** Shard PostgreSQL geographically by state/region (e.g., West Bengal, Maharashtra, Delhi NCR), since telemedicine doctor licenses and ambulance dispatch are inherently local to state jurisdictions.
2. **Read Replicas:** Route doctor directory searches and static availability queries to read-replicas with Redis caching layer (`stale-while-revalidate`).
3. **Edge Video Gateways:** Deploy LiveKit SFU nodes at regional edge locations (Mumbai, Chennai, Kolkata, Delhi) to minimize video round-trip latency.
4. **Event Streaming:** Transition the BullMQ outbox relay to an enterprise event bus (Apache Kafka) for high-throughput cross-service event streaming and analytics.
