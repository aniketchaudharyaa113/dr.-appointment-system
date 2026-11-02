# Risk Analysis & Mitigation Matrix (Top 15 Production Risks)

This document details the top 15 critical failure modes identified for the MediBook platform, along with the precise mitigation mechanism engineered into the system and the automated test that proves its correctness.

---

## Risk Matrix Summary

| # | Risk Description | Severity | Mitigation Strategy | Proof Test |
| :- | :--- | :--- | :--- | :--- |
| **1** | **Concurrent Double-Booking** | Critical | Partial Unique Index on `(doctor_id, slot_time)` + Redis hold lock | `scheduling.concurrency.spec.ts` (50 parallel requests) |
| **2** | **Duplicate Charge / Double Payment** | Critical | Idempotency keys on order creation + DB unique constraints | `payments.idempotency.spec.ts` |
| **3** | **Webhook Replay Attack / Flood** | High | Raw HMAC-SHA256 signature check + `UNIQUE(provider_event_id)` in webhook inbox | `payments.webhook.replay.spec.ts` (10x replay flood) |
| **4** | **Late Payment After Slot Loss** | High | Atomic check on slot state during webhook capture; auto-refund if slot taken | `payments.late-payment-refund.spec.ts` |
| **5** | **Double-Entry Ledger Imbalance** | Critical | Strict transactional double-entry ledger where debit sum = credit sum | `payments.ledger.balance.spec.ts` |
| **6** | **Unauthenticated / Unauthorized Video Access** | Critical | Server-minted LiveKit tokens with strict identity and join-window enforcement (-10m/+30m) | `consultation.token-security.spec.ts` |
| **7** | **Socket Data Leakage Between Users** | High | JWT handshake authentication; events scoped strictly to authorized room IDs (`consult:<id>`, `user:<id>`) | `socket.isolation.spec.ts` |
| **8** | **PHI Leakage in Audit Trails / Logs** | High | Pino redaction serializers for passwords, tokens, and prescription JSON; explicit read audits | `audit.phi-redaction.spec.ts` |
| **9** | **AI Hallucination in Clinical Advice** | High | Strict RAG pipeline with verified clinical corpus, threshold-based refusal, and explicit citations | `ai.rag.citations.spec.ts` |
| **10** | **Emergency Misclassification (False Negative)** | Critical | Rule-based and classifier triage interception executing *before* any LLM call | `ai.triage.emergency-recall.spec.ts` (100% recall on test set) |
| **11** | **AI Agent Privilege Escalation** | High | Booking tool calling executes strictly with the authenticated end-user's JWT credentials | `ai.agent.privilege-scope.spec.ts` |
| **12** | **Ambulance Split-Brain Dispatch Race** | High | Atomic Redis `SETNX` lock or conditional SQL update ensuring exactly one driver wins | `ambulance.claim-race.spec.ts` |
| **13** | **Stale Ambulance Driver Telemetry** | Medium | Redis key TTL heartbeat (15s); stale drivers automatically evicted from GEO index | `ambulance.heartbeat-eviction.spec.ts` |
| **14** | **Doctor Leave Orphaning Existing Bookings** | High | Leave creation runs dry-run conflict check; cascades cancellations with full auto-refunds and notifications | `scheduling.leave-cascade.spec.ts` |
| **15** | **Database / Redis Network Partition (Dual-Write Loss)** | Critical | Transactional Outbox pattern; domain state and outbox event written in same ACID transaction | `outbox.transaction-safety.spec.ts` |

---

## Detailed Risk Mitigations & Test Specifications

### Risk 1: Concurrent Double-Booking
- **Failure Mode**: Two patients submit booking requests for the exact same doctor and slot at the exact same millisecond. Both requests pass application validation and commit to the database.
- **Engineered Mitigation**: 
  1. Temporary Redis distributed hold lease `SET slot:hold:docId:time patientId NX EX 600`.
  2. Database-level partial unique index: `CREATE UNIQUE INDEX idx_appointments_active ON appointments(doctor_id, slot_time) WHERE status IN ('PENDING_PAYMENT', 'CONFIRMED');`.
  3. Cancelled slots (`status = 'CANCELLED'`) are excluded from the index, allowing immediate rebooking.
- **Proof Test (`scheduling.concurrency.spec.ts`)**:
  Fires 50 simultaneous parallel HTTP booking requests for the same slot. Verifies exactly 1 request returns HTTP 201 Created and exactly 49 requests return HTTP 409 Conflict. Verifies exactly 1 row exists in `appointments`.

---

### Risk 2: Duplicate Charge / Double Payment
- **Failure Mode**: Network jitter causes the browser to send two order creation requests, generating multiple gateway payment links for a single checkout session.
- **Engineered Mitigation**:
  Each checkout request requires an `idempotency-key` header (UUID). The API checks `idempotency_keys` table using a transaction. If the key exists, it returns the cached order response without calling Razorpay again.
- **Proof Test (`payments.idempotency.spec.ts`)**:
  Simultaneously executes 5 identical order creation requests with identical idempotency keys. Verifies that only 1 external order is created and all 5 requests return identical responses.

---

### Risk 3: Webhook Replay Attack / Flood
- **Failure Mode**: An attacker intercepts a legitimate Razorpay `payment.captured` webhook and replays it 100 times to artificially credit doctor balances or trigger duplicate ledger postings.
- **Engineered Mitigation**:
  1. Fastify raw-body HMAC-SHA256 signature verification matches `X-Razorpay-Signature`.
  2. Webhook payload is inserted into `payment_events` with a `UNIQUE(provider_event_id)` constraint.
  3. If duplicate, the query triggers an `ON CONFLICT DO NOTHING` and returns HTTP 200 immediately without enqueuing processing jobs.
- **Proof Test (`payments.webhook.replay.spec.ts`)**:
  Fires the same signed webhook payload 10 times concurrently. Asserts that the payment is updated once, exactly one set of ledger entries is written, and all 10 calls return HTTP 200.

---

### Risk 4: Late Payment After Slot Loss
- **Failure Mode**: Patient A initiates checkout for 10:00 AM slot. Patient A waits 15 minutes before paying in Razorpay. In the meantime, the 10-minute hold expires and Patient B books and pays for the slot. When Patient A's webhook finally arrives, Patient B's appointment is overwritten or Patient A loses money without an appointment.
- **Engineered Mitigation**:
  When the worker processes `payment.captured`, it acquires a row lock on the slot. If the slot is already confirmed by another patient, the system updates Patient A's payment status to `REFUNDED` and immediately enqueues a full automated refund job to the payment gateway.
- **Proof Test (`payments.late-payment-refund.spec.ts`)**:
  Simulates a captured webhook arriving 20 minutes after hold expiry when the slot has already been taken by another user. Verifies that an automated refund record is created and the existing appointment is untouched.

---

### Risk 5: Double-Entry Ledger Imbalance
- **Failure Mode**: Software bug or partial database write records patient payment but fails to record escrow debit, causing financial discrepancies in platform accounting.
- **Engineered Mitigation**:
  All financial operations write balanced debit and credit entries inside an atomic database transaction. An integrity check asserts: `SELECT SUM(amount_paise) FROM ledger_entries WHERE transaction_id = $1` must equal zero (where debits are positive and credits are negative).
- **Proof Test (`payments.ledger.balance.spec.ts`)**:
  Executes full payment settlement and refund cycles. Runs automated audit assertions checking that total debits minus total credits equal zero across all platform accounts.

---

### Risk 6: Unauthenticated / Unauthorized Video Access
- **Failure Mode**: Malicious user guesses a consultation room name or UUID and joins the WebRTC media feed of another patient's private consultation.
- **Engineered Mitigation**:
  1. LiveKit room names use internal unguessable tokens.
  2. The LiveKit access token is minted exclusively by NestJS API via `LiveKitService`.
  3. The API checks: (a) user is verified patient or doctor of that appointment, and (b) current time is within `slot_time - 10 min` and `slot_time + 30 min`.
- **Proof Test (`consultation.token-security.spec.ts`)**:
  Attempts to fetch join tokens: (1) with an unauthorized user ID (asserts 403 Forbidden), (2) 2 hours before the appointment (asserts 400 Bad Request), and (3) as the valid patient during the window (asserts 200 OK with valid JWT).

---

### Risk 7: Socket Data Leakage Between Users
- **Failure Mode**: A WebSocket client listens to global broadcast channels and receives private chat messages or ambulance telemetry intended for another user.
- **Engineered Mitigation**:
  Every Socket.IO connection authenticates via JWT in the connection handshake. Client sockets are strictly restricted to join rooms explicitly authorized for their User ID: `user:<id>` and `consult:<appointmentId>`.
- **Proof Test (`socket.isolation.spec.ts`)**:
  Connects Client A and Client B. Client A emits a message to room `consult:123`. Proves that Client B (not in room 123) receives zero socket events.

---

### Risk 8: PHI Leakage in Audit Trails / Logs
- **Failure Mode**: Clinical diagnoses, patient symptoms, or authentication tokens are logged in plain text in production log aggregators.
- **Engineered Mitigation**:
  Pino logger configured with strict redaction paths: `req.headers.authorization`, `req.headers.cookie`, `password`, `medicines`, `diagnosis`, and `credit_card`. Explicit access to clinical records is logged in an encrypted `audit_logs` table.
- **Proof Test (`audit.phi-redaction.spec.ts`)**:
  Executes prescription retrieval and login requests. Inspects captured log streams and asserts that sensitive keys are replaced with `[REDACTED]`.

---

### Risk 9: AI Hallucination in Clinical Advice
- **Failure Mode**: AI Assistant invents incorrect medication dosages or false medical claims when answering patient inquiries.
- **Engineered Mitigation**:
  1. RAG pipeline grounds answers strictly in verified corpus chunks.
  2. Embeddings generated via pgvector; similarity score threshold enforced. If retrieval confidence is low, the model returns a standard fallback: *"I cannot find reliable clinical information on this topic. Please consult a licensed medical professional."*
  3. Every claim requires source citation chips `[Source: Doc Name, §X]`.
- **Proof Test (`ai.rag.citations.spec.ts`)**:
  Queries the AI service with unknown medical queries. Verifies fallback message is returned. Queries with valid corpus topics and asserts citation objects are included in response payload.

---

### Risk 10: Emergency Misclassification (False Negative)
- **Failure Mode**: A patient with symptoms of an acute myocardial infarction or stroke asks the AI assistant a question; the LLM enters a verbose chat dialogue instead of directing immediate emergency care.
- **Engineered Mitigation**:
  A deterministic rule-based matcher + high-sensitivity classifier executes **before** any generative LLM pipeline. If red-flag symptoms are present (chest pain, numbness in arm, severe hemorrhage, respiratory arrest), generative processing is aborted and an immediate emergency response card is returned with click-to-call 112 and ambulance dispatch CTA.
- **Proof Test (`ai.triage.emergency-recall.spec.ts`)**:
  Evaluates 100 benchmark emergency prompts. Asserts 100% recall (zero false negatives) on life-threatening symptom inputs.

---

### Risk 11: AI Agent Privilege Escalation
- **Failure Mode**: The AI booking agent is tricked via prompt injection into booking an appointment on behalf of another user or booking without holding funds.
- **Engineered Mitigation**:
  When the AI agent invokes tool calls (e.g. `holdSlot`, `createOrder`), it forwards the end-user's authenticated Bearer token. The API validates all authorizations as if the user clicked the button directly.
- **Proof Test (`ai.agent.privilege-scope.spec.ts`)**:
  Attempts to invoke booking tool with Patient A's session targeting Patient B's appointment. Proves that API returns 403 Forbidden.

---

### Risk 12: Ambulance Split-Brain Dispatch Race
- **Failure Mode**: Two nearby drivers click "Accept Dispatch" at the exact same moment. Both believe they have been assigned to the emergency.
- **Engineered Mitigation**:
  Ambulance acceptance executes an atomic update: `UPDATE ambulance_requests SET status = 'ACCEPTED', driver_id = $1 WHERE id = $2 AND status = 'OFFERED' RETURNING *;`. Exactly one driver updates 1 row; the second driver updates 0 rows and receives HTTP 409 Conflict.
- **Proof Test (`ambulance.claim-race.spec.ts`)**:
  Launches 10 simultaneous accept requests from 10 distinct driver tokens for a single offered dispatch. Asserts exactly 1 driver receives 200 OK and 9 receive 409 Conflict.

---

### Risk 13: Stale Ambulance Driver Telemetry
- **Failure Mode**: A driver's phone runs out of battery or loses network while online. The system continues to offer emergencies to this phantom driver, delaying patient rescue.
- **Engineered Mitigation**:
  Driver location is held in Redis with an expiring heartbeat TTL (15 seconds). If no location ping is received within 15 seconds, a Redis key-expiration hook removes the driver from the active `drivers:locations` GEO index.
- **Proof Test (`ambulance.heartbeat-eviction.spec.ts`)**:
  Registers an active driver, waits 16 seconds without telemetry, and queries nearby drivers. Asserts driver is absent from results.

---

### Risk 14: Doctor Leave Orphaning Existing Bookings
- **Failure Mode**: A doctor books a week of emergency leave on dates where 25 patients already have confirmed appointments. The appointments remain active without the doctor being present.
- **Engineered Mitigation**:
  Applying for leave executes a dry-run check displaying impacted appointments. Upon confirmation, it executes a cascading cancellation transaction: marks appointments `CANCELLED_BY_DOCTOR`, issues full 100% refunds, notifies patients via SMS/Email, and records audit logs.
- **Proof Test (`scheduling.leave-cascade.spec.ts`)**:
  Creates 3 confirmed appointments on date X. Applies doctor leave on date X. Verifies all 3 appointments transition to `CANCELLED`, 3 refund jobs are created, and patients receive cancellation notifications.

---

### Risk 15: Database / Redis Network Partition (Dual-Write Loss)
- **Failure Mode**: Application successfully saves an appointment to PostgreSQL, but the server crashes before sending the job to Redis/BullMQ. The appointment is saved, but the patient never receives an email, calendar invite, or SMS confirmation.
- **Engineered Mitigation**:
  Transactional Outbox pattern. The domain mutation and the `outbox_events` record are saved in the exact same PostgreSQL ACID transaction. A resilient worker process polls the outbox and guarantees at-least-once message delivery to BullMQ.
- **Proof Test (`outbox.transaction-safety.spec.ts`)**:
  Simulates a worker crash after outbox write. Restarts worker and verifies all unacknowledged outbox events are drained and dispatched without loss.
