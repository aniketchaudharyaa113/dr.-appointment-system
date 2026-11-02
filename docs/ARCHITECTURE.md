# MediBook Architecture Specification (C4 Model & Data Flows)

## 1. System Overview
MediBook is a production-grade, secure, and resilient telehealth platform designed to handle real-world clinical and emergency workflows. It bridges patients, medical practitioners, emergency responders, and clinic administrative staff through a low-latency, modular monolithic architecture.

---

## 2. C4 Context Diagram (System Context)

```mermaid
C4Context
  title System Context Diagram for MediBook Telehealth Platform

  Person(patient, "Patient", "Searches doctors, books appointments, makes payments, joins video/chat consults, requests emergency ambulances, and queries AI assistant.")
  Person(doctor, "Doctor", "Manages schedules/leaves, conducts video consultations, writes immutable prescriptions, and reviews AI draft notes.")
  Person(admin, "Admin", "Verifies doctor medical licenses, audits PHI access, inspects ledger reconciliations, and monitors system queues.")
  Person(driver, "Ambulance Driver", "Broadcasts GPS telemetry, receives dispatch offers, and fulfills emergency dispatches.")

  System(medibook, "MediBook Platform", "Modular monolith backend, standalone background worker, Next.js web application, and Python AI intelligence service.")

  System_Ext(razorpay, "Payment Gateway (Razorpay/Stripe)", "Processes card, UPI, and netbanking transactions, dispatching signed webhook events.")
  System_Ext(livekit, "LiveKit RTC Media Server", "Handles WebRTC audio/video SFU media tracks and dynamic peer connections.")
  System_Ext(minio, "MinIO / S3 Storage", "Secure object store for medical records, signed chat attachments, and PDF prescriptions.")
  System_Ext(mailpit, "SMTP Gateway / Mailpit", "Transactional email delivery for notifications, booking confirmations, and reminders.")
  System_Ext(osm, "OpenStreetMap / Leaflet", "Tile servers and routing APIs for geolocation, hospital mapping, and driver tracking.")

  Rel(patient, medibook, "Uses web portal over HTTPS/WSS", "Next.js / REST / WebSockets")
  Rel(doctor, medibook, "Manages clinic and consults over HTTPS/WSS", "Next.js / REST / WebSockets")
  Rel(admin, medibook, "Oversees operations and audits over HTTPS", "Next.js / REST")
  Rel(driver, medibook, "Streams GPS telemetry and accepts dispatches", "Next.js / WebSockets")

  Rel(medibook, razorpay, "Initiates orders and receives signed webhooks", "HTTPS")
  Rel(medibook, livekit, "Mints access tokens and coordinates rooms", "gRPC / REST")
  Rel(medibook, minio, "Generates pre-signed upload/download URLs", "S3 API")
  Rel(medibook, mailpit, "Sends transactional emails", "SMTP")
  Rel(patient, osm, "Fetches map tiles", "HTTPS")
```

---

## 3. C4 Container Diagram

```mermaid
C4Container
  title Container Diagram for MediBook

  Boundary(c1, "MediBook System Monorepo") {
    Container(web, "Web Application", "Next.js 15, React 19, Tailwind CSS, shadcn/ui", "Provides accessible, responsive UI for Patients, Doctors, Admins, and Drivers.")
    Container(nginx, "Reverse Proxy & Edge Gateway", "Nginx", "Terminates TLS, applies rate limits, routes /api to API and /ws to WebSockets.")
    Container(api, "Modular Monolith API", "NestJS, Fastify, TypeScript", "Core domain services: Identity, Scheduling, Payments, Consultation, Ambulance, Notifications, Admin.")
    Container(worker, "Background Worker", "NestJS Standalone, BullMQ", "Processes Transactional Outbox, payment reconciliations, waitlist expiry, and dispatch timeouts.")
    Container(ai_service, "AI Intelligence Service", "Python 3.11, FastAPI, Pydantic, pgvector", "Symptom triage, RAG with medical corpus, consultation summarizer, and booking agent.")
  }

  Boundary(c2, "State & Infrastructure") {
    ContainerDb(postgres, "Relational Database", "PostgreSQL 16 + pgvector + pg_trgm", "Stores users, appointments, ledgers, outbox, prescriptions, embeddings, and audit trails.")
    ContainerDb(redis, "In-Memory Store & Broker", "Redis 7", "Slot hold leases, distributed locks, rate-limit counters, BullMQ queues, and GEO driver indices.")
    ContainerDb(minio_storage, "Object Store", "MinIO (S3-compatible)", "Stores immutable prescription PDFs and encrypted chat attachments.")
    Container(livekit_sfu, "LiveKit Media SFU", "LiveKit Server", "Handles WebRTC peer video/audio media transmission.")
  }

  Rel(web, nginx, "HTTPS / WSS requests", "Port 80/443")
  Rel(nginx, web, "Passes frontend requests", "Port 3000")
  Rel(nginx, api, "Passes /api & /socket.io requests", "Port 4000")

  Rel(api, postgres, "Reads/Writes application state", "Prisma / Hand-written SQL")
  Rel(api, redis, "Manages holds, locks, rate limits, and pub/sub", "ioredis")
  Rel(api, ai_service, "Invokes triage & RAG over HTTP with circuit breaker", "HTTP / REST")
  Rel(api, livekit_sfu, "Mints scoped JWT join tokens", "livekit-server-sdk")
  Rel(api, minio_storage, "Generates signed PUT/GET URLs", "AWS S3 SDK")

  Rel(worker, postgres, "Reads outbox events, updates appointment/payment state", "Prisma")
  Rel(worker, redis, "Consumes BullMQ queues and handles scheduled tasks", "BullMQ")
  Rel(ai_service, postgres, "Vector similarity search and embeddings", "pgvector SQL")
```

---

## 4. Module Map (NestJS Modular Monolith)

Inside `apps/api/src/modules/`, modules interact strictly via exported interface contracts and domain events. No cross-module database table access is allowed.

```mermaid
graph TD
  subgraph Platform_Core ["Platform Core (Cross-Cutting)"]
    ConfigModule[ConfigModule - Strict Zod Validation]
    DatabaseModule[DatabaseModule - Prisma + Raw Pool]
    OutboxModule[OutboxModule - Transactional Outbox]
    RedisModule[RedisModule - Cache, Locks & GEO]
    AuthGuardModule[AuthGuardModule - Argon2 & JWT RBAC]
    AuditModule[AuditModule - PHI & Action Logger]
  end

  subgraph Domain_Modules ["Bounded Domain Contexts"]
    Identity[IdentityModule]
    Scheduling[SchedulingModule]
    Payments[PaymentsModule]
    Consultation[ConsultationModule]
    Ambulance[AmbulanceModule]
    Notifications[NotificationsModule]
    AiGateway[AiGatewayModule]
    Admin[AdminModule]
  end

  Identity -->|User Verified / Registered| OutboxModule
  Scheduling -->|Slot Held / Booked / Cancelled| OutboxModule
  Scheduling -->|Acquire Lock & Hold| RedisModule
  Payments -->|Payment Captured / Refunded| OutboxModule
  Payments -->|State Check| Scheduling
  Consultation -->|Prescription Issued| OutboxModule
  Consultation -->|Audit PHI Read| AuditModule
  Ambulance -->|Driver Location / Dispatch| RedisModule
  Ambulance -->|Dispatch Event| OutboxModule
  AiGateway -->|HTTP with Circuit Breaker| PythonAIService[services/ai]
  Admin -->|Audit Queries & Queue Telemetry| DatabaseModule
```

---

## 5. End-to-End Data Flows

### 5.1 Booking & Payment Flow (Hold -> Razorpay -> Webhook -> Confirm)
```mermaid
sequenceDiagram
  autonumber
  actor Patient
  participant Web as Next.js Web
  participant API as Scheduling / Payments API
  participant Redis as Redis (Holds & Locks)
  participant DB as PostgreSQL (Prisma)
  participant RZ as Razorpay Provider
  participant Worker as Background Worker

  Patient->>Web: Select Doctor & Slot (Asia/Kolkata)
  Web->>API: POST /appointments/hold (doctorId, slotTime)
  API->>Redis: SET slot:hold:docId:slotTime (patientId, NX, EX 600)
  alt Slot already held or booked
    Redis-->>API: Nil (Already Held)
    API-->>Web: 409 Conflict (Slot Unavailable)
  else Slot Hold Acquired
    Redis-->>API: OK
    API-->>Web: 200 OK (holdToken, expiresAt)
    Patient->>Web: Proceed to Checkout
    Web->>API: POST /payments/create-order (holdToken, amountPaise)
    API->>RZ: Create Order (amount, currency="INR", receipt)
    RZ-->>API: order_id
    API->>DB: INSERT INTO payments (status=PENDING, order_id, slot_hold)
    API-->>Web: 200 OK (order_id, razorpay_key, amount)
    Patient->>RZ: Complete UPI / Card Payment
    RZ->>API: POST /payments/webhook (raw HMAC signature)
    API->>API: Verify HMAC signature
    API->>DB: INSERT INTO payment_events (event_id, payload) ON CONFLICT DO NOTHING
    API-->>RZ: 200 OK (Fast Ack)
    Worker->>DB: Read pending payment_events
    Worker->>DB: BEGIN TX; SELECT * FROM payments FOR UPDATE;
    Worker->>DB: Check slot hold validity & transition payment to CAPTURED
    Worker->>DB: INSERT INTO appointments (status=CONFIRMED, booking_ref)
    Worker->>DB: INSERT INTO ledger_entries (double-entry balancing)
    Worker->>DB: INSERT INTO outbox_events (AppointmentConfirmed)
    Worker->>DB: COMMIT TX
    Worker->>Redis: DEL slot:hold:docId:slotTime
    Worker->>API: Outbox relay triggers Socket.io notification to Patient & Doctor
  end
```

### 5.2 Asynchronous Webhook Processing Flow
```mermaid
flowchart TD
  WH[Payment Webhook Received] --> RawSig{Verify HMAC Raw Body}
  RawSig -- Invalid --> Reject[400 Bad Request & Audit Log]
  RawSig -- Valid --> IdempCheck[Insert Into payment_events ON CONFLICT DO NOTHING]
  IdempCheck --> Ack[Return 200 OK Immediately]
  Ack --> Queue[BullMQ payment-processing Queue]
  Queue --> WorkerJob[Worker Processes Event in DB Transaction]
  WorkerJob --> LockPayment[SELECT payment FOR UPDATE]
  LockPayment --> TransitionCheck{Valid State Transition?}
  TransitionCheck -- No / Duplicate --> Skip[Log & Mark Event Processed]
  TransitionCheck -- Yes --> UpdateState[Update Payment & Confirm / Refund]
  UpdateState --> WriteLedger[Write Double-Entry Ledger Records]
  WriteLedger --> EmitOutbox[Insert Outbox Event]
```

### 5.3 LiveKit Video Join Flow
```mermaid
sequenceDiagram
  autonumber
  actor User as Patient / Doctor
  participant Web as Next.js Consultation View
  participant API as Consultation API
  participant DB as PostgreSQL
  participant LK as LiveKit Server

  User->>Web: Navigate to /consultations/:id
  Web->>API: GET /consultations/:id/join-token
  API->>DB: Validate user is doctor or patient of appointment
  API->>DB: Verify current time is inside join window (-10m to +30m)
  alt Outside Join Window or Unauthorized
    API-->>Web: 403 Forbidden / 400 Window Not Active
  else Access Approved
    API->>LK: Generate AccessToken (room="consult:<id>", identity, permissions)
    API-->>Web: 200 OK { token, livekitUrl }
    Web->>LK: Connect to LiveKit Room using Token
    LK-->>Web: WebRTC Peer Connection Established
    Web->>API: POST /consultations/:id/status (IN_PROGRESS)
  end
```

### 5.4 Consultation Chat Message Flow
```mermaid
sequenceDiagram
  autonumber
  actor Sender as Patient / Doctor
  participant Web as Client Web Socket
  participant Gate as NestJS Socket Gateway
  participant Auth as Redis / JWT Auth
  participant DB as PostgreSQL
  actor Recipient as Doctor / Patient

  Sender->>Gate: WS connect (Bearer JWT in handshake)
  Gate->>Auth: Validate JWT & User Active
  Gate-->>Sender: Connected & Joined room: consult:<id>
  Sender->>Gate: WS event: "chat:send" { consultationId, content, attachmentUrl }
  Gate->>DB: Verify user is participant & follow-up window active (<= 7 days)
  Gate->>DB: INSERT INTO consultation_messages (sender_id, content, delivered=true)
  Gate->>Recipient: Broadcast "chat:received" to room: consult:<id>
  Sender->>Gate: Ack message sent
```

### 5.5 Emergency Ambulance Dispatch Flow
```mermaid
sequenceDiagram
  autonumber
  actor Patient
  actor Driver1 as Nearest Driver
  actor Driver2 as Next Driver
  participant Web as Web Client
  participant AmbModule as Ambulance API & Gateway
  participant Redis as Redis (GEO & Locks)
  participant DB as PostgreSQL

  Patient->>Web: Press "Request Emergency Ambulance" (Lat, Lng)
  Web->>AmbModule: POST /ambulance/request { latitude, longitude }
  AmbModule->>DB: INSERT INTO ambulance_requests (status=REQUESTED)
  AmbModule->>Redis: GEORADIUS drivers:locations 10km ASC
  Redis-->>AmbModule: [Driver1, Driver2, ...]
  AmbModule->>AmbModule: Select Driver1, set status=OFFERED (timeout: 20s)
  AmbModule->>Driver1: WS offer dispatch (20s countdown)
  alt Driver1 Ignores / Rejects
    AmbModule->>AmbModule: 20s Timer Expires
    AmbModule->>Driver2: WS offer dispatch to next candidate
  else Driver1 Accepts
    Driver1->>AmbModule: POST /ambulance/accept { requestId }
    AmbModule->>Redis: SETNX lock:dispatch:reqId driverId
    alt Driver1 Wins Lock
      AmbModule->>DB: UPDATE ambulance_requests SET status=ACCEPTED, driver_id=Driver1
      AmbModule->>Web: WS dispatch:status { status: ACCEPTED, driverLocation, eta }
      loop Every 3 seconds
        Driver1->>AmbModule: WS driver:location { lat, lng }
        AmbModule->>Redis: GEOADD drivers:locations lng lat Driver1
        AmbModule->>Web: WS dispatch:tracking { lat, lng, eta }
      end
    else Already Claimed
      AmbModule-->>Driver1: 409 Offer already claimed
    end
  end
```

### 5.6 AI Assistant Request (Triage + RAG + Tool Calling)
```mermaid
sequenceDiagram
  autonumber
  actor Patient
  participant Web as Next.js Chat Drawer
  participant Gate as AI Gateway (NestJS)
  participant PythonAI as Python AI Service (FastAPI)
  participant PGVector as PostgreSQL (pgvector + pg_trgm)

  Patient->>Web: "I have acute chest pain and shortness of breath"
  Web->>Gate: POST /ai/chat { message, conversationId }
  Gate->>PythonAI: POST /triage-and-respond { query, userId }
  PythonAI->>PythonAI: Rule-based & Small Classifier Emergency Detector
  alt Emergency Detected (Chest Pain, Stroke signs, Severe Trauma)
    PythonAI-->>Gate: { isEmergency: true, emergencyCard: "Call 112 immediately" }
    Gate-->>Web: Emergency Takeover UI (Call 112 button & Ambulance dispatch CTA)
  else Standard Health / Booking Query
    PythonAI->>PGVector: Hybrid Search (pg_trgm tsvector + 768-dim vector embeddings)
    PGVector-->>PythonAI: Top-K Clinical Corpus & FAQ Chunks + User Records
    PythonAI->>PythonAI: Filter weak retrieval / Check Confidence
    PythonAI->>PythonAI: Formulate response with explicit citations [Doc 1, Doc 2]
    alt Query intent is Doctor Booking
      PythonAI->>Gate: Tool Call: searchDoctors(specialty="Cardiology", date="Today")
      Gate-->>PythonAI: Tool Result: [Dr. Sharma, 16:00, 16:30]
      PythonAI-->>Gate: Structured Booking Action Card
    end
    PythonAI-->>Gate: Generated Response + Citations + Actions
    Gate-->>Web: Streamed Assistant Markdown Response
  end
```
