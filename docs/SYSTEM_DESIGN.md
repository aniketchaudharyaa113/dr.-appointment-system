# MediBook — High-Level Design (HLD) & Low-Level Design (LLD)

## 1. Executive Summary

**MediBook** is a production-grade, distributed doctor appointment and clinic management system designed for high concurrency, zero double-booking guarantees, sub-50ms slot reads, and resilient asynchronous event processing.

This document details the **High-Level Design (HLD)** and **Low-Level Design (LLD)** of MediBook, incorporating an **Nginx Web Server/Reverse Proxy**, **Redis Caching Tier**, **Asynchronous Message Queue**, and **PostgreSQL ACID Persistence Engine**.

---

## 2. High-Level Architecture (HLD)

### 2.1 Multi-Tier Architecture Diagram

```
                              ┌─────────────────────────┐
                              │     Patients / Doctors  │
                              │     (Web Browsers)      │
                              └────────────┬────────────┘
                                           │ HTTP/HTTPS & WebSockets
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │               NGINX WEB SERVER               │
                    │        (Reverse Proxy & Load Balancer)       │
                    │  - Rate Limiting (20r/s API, 5r/s Auth)      │
                    │  - Static Asset Caching (gzip / 1y TTL)     │
                    │  - WebSocket Upgrade Proxy (/socket.io/)     │
                    │  - Security Headers (CSP, HSTS, X-Frame)     │
                    └───────┬──────────────────────────────┬───────┘
                            │                              │
         Static Assets (/)  │                              │ /api/ & /socket.io/
                            ▼                              ▼
                 ┌────────────────────┐         ┌─────────────────────────┐
                 │ Frontend SPA Build │         │ Node.js / Express API   │
                 │ (React + Vite)     │         │ Cluster (Port 5000)     │
                 └────────────────────┘         └────────────┬────────────┘
                                                             │
                  ┌──────────────────────────────────────────┼──────────────────────────────────────────┐
                  │                                          │                                          │
                  ▼                                          ▼                                          ▼
     ┌─────────────────────────┐                ┌─────────────────────────┐                ┌─────────────────────────┐
     │      REDIS CACHE        │                │   ASYNCHRONOUS QUEUE    │                │  POSTGRESQL 16 (ACID)   │
     │  - Doctor Profiles      │                │   (Producer-Consumer)   │                │  - Users / Doctors      │
     │  - Search Results       │                │  - Booking Confirms     │                │  - Appointments         │
     │  - Booked Slots         │                │  - In-App Alerts        │                │  - Daily Token Counters │
     │  - Admin Statistics     │                │  - Audit Logs           │                │  - Prescriptions        │
     │  - In-memory Fallback   │                │  - Email Dispatches     │                │  - Doctor Leaves        │
     └─────────────────────────┘                └─────────────────────────┘                └─────────────────────────┘
```

### 2.2 System Components & Responsibilities

| Tier | Component | Technology | Primary Responsibility |
|---|---|---|---|
| **Edge / Proxy** | Reverse Proxy & Ingress | Nginx 1.25 Alpine | SSL termination, DDoS protection, rate limiting (`limit_req`), WebSocket tunneling, gzip compression, static delivery |
| **Presentation** | Web Application | React 18 + Vite + Tailwind CSS | Responsive patient booking portal, doctor dashboard, admin verification operations center |
| **Application** | API Gateway & Business Logic | Node.js + Express + TypeScript | Zod validation, JWT authentication, naive wall-clock datetime math, Socket.IO real-time hub |
| **Caching** | High-Performance Cache | Redis 7 Alpine / Memory Fallback | Cache-aside pattern for doctor availability, slots, symptom search, and admin dashboards |
| **Messaging** | Job Queue & Background Worker | Redis List / PubSub + Worker | Decoupled background task dispatch (SMS/email stubs, notifications, system audit logs) |
| **Persistence** | Relational Database | PostgreSQL 16 | ACID transactions, row-level locks, unique constraints for strict zero-double-booking |

---

## 3. Low-Level Design (LLD)

### 3.1 Concurrency & Zero Double-Booking Sequence

A critical invariant of the platform is that **no two concurrent requests can ever book the same doctor slot**, and **booking reference tokens (`MB-YYYYMMDD-XXX`) can never collide**.

```
Client 1 (Patient A)        Client 2 (Patient B)           Backend API            PostgreSQL (ACID)            Redis / WebSockets
       │                            │                            │                         │                           │
       │─── POST /appointments ────>│                            │                         │                           │
       │    (Dr. Roy, 10:00 AM)     │                            │                         │                           │
       │                            │─── POST /appointments ────>│                         │                           │
       │                            │    (Dr. Roy, 10:00 AM)     │                         │                           │
       │                            │                            │                         │                           │
       │                            │                            │─── BEGIN TRANSACTION ──>│                           │
       │                            │                            │─── ROW LOCK Counter ───>│ (ON CONFLICT DO UPDATE)   │
       │                            │                            │    Token seq: 001       │                           │
       │                            │                            │─── INSERT Appointment ─>│ [Acquires (doc, time) lock]│
       │                            │                            │─── COMMIT ─────────────>│                           │
       │                            │                            │                         │                           │
       │                            │                            │─── Invalidate Cache ───────────────────────────────>│ DEL medibook:slots:doc1
       │                            │                            │─── Broadcast Slot Booked ──────────────────────────>│ emit("slot-booked")
       │                            │                            │─── Enqueue Notification ───────────────────────────>│ PUSH Job -> Queue
       │<── 201 Created (MB-..-001) ─│                           │                                                     │
       │                            │                            │                                                     │
       │                            │                            │─── BEGIN TRANSACTION ──>│                           │
       │                            │                            │─── INSERT Appointment ─>│ 💥 Unique Violation 23505 │
       │                            │                            │    (doc1, 10:00) exists │                           │
       │                            │                            │─── ROLLBACK ───────────>│                           │
       │                            │<── 409 Conflict ───────────│                         │                           │
       │                            │    ("Slot just taken")     │                         │                           │
```

### 3.2 Caching Strategy (Cache-Aside with Atomic Invalidation)

1. **Read Path**:
   - `GET /doctors/:id/booked-slots`:
     - Checks key `medibook:slots:<doctorId>`.
     - **Cache Hit**: Returns cached slot array in < 2ms.
     - **Cache Miss**: Queries PostgreSQL for `slot_time > NOW()`, stores in Redis with 60s TTL, and returns.
2. **Write Invalidation**:
   - When `createAppointment()` commits:
     - `cacheDel("medibook:slots:" + doctorId)`
     - `cacheDelPattern("medibook:admin:*")`
   - When `cancelAppointment()` commits:
     - `cacheDel("medibook:slots:" + doctorId)`
     - `cacheDelPattern("medibook:admin:*")`

### 3.3 Asynchronous Message Queue Design

```
[ HTTP Request Thread ]
         │
         ▼
  enqueueJob(type, payload)
         │
         ├──> Redis Connected? ──► YES ──► RPUSH medibook:jobs:queue (JSON)
         │                         │
         └──> NO (Fallback)        └───► In-Memory Buffer
                    │                              │
                    ▼                              ▼
      [ Background Worker Thread ]  ◄───── BLPOP (Timeout: 2s)
                    │
         ┌──────────┴────────────────────────┐
         ▼                                   ▼
    JOB: NOTIFICATION                   JOB: AUDIT
  - Insert into notifications         - Insert into audit_logs
  - Real-time emit to patient         - Log security/system events
    via Socket (`notification:userId`)
```

---

## 4. Database Schema Design (ERD)

```
users (id UUID, email, password, name, phone, role, created_at)
  │
  ├── 1:1 ── doctors (id UUID, user_id, specialty, qualifications, experience_years,
  │                   clinic_name, clinic_address, clinic_lat, clinic_lng,
  │                   consultation_fee, license_number, is_verified)
  │             │
  │             ├── 1:N ── availability (id, doctor_id, day_of_week, start_time, end_time, slot_duration)
  │             ├── 1:N ── doctor_leaves (id, doctor_id, leave_date, reason)
  │             ├── 1:N ── doctor_daily_counters (doctor_id, booking_date, last_seq)
  │             │
  │             └── 1:N ── appointments (id, patient_id, doctor_id, slot_time, status, booking_ref)
  │                           │             UNIQUE(doctor_id, slot_time)
  │                           │
  │                           ├── 1:1 ── prescriptions (id, appointment_id, doctor_id, patient_id, diagnosis, medicines JSONB, notes)
  │                           └── 1:1 ── reviews (id, doctor_id, patient_id, rating, comment)
  │
  ├── 1:N ── notifications (id, user_id, type, title, message, link, is_read, created_at)
  └── 1:N ── audit_logs (id, actor_id, actor_role, action, target_id, details JSONB, created_at)
```

---

## 5. Nginx Web Server Design

### Rate Limiting & DoS Protection
- `zone=api_limit`: 20 requests/second with burst 30.
- `zone=auth_limit`: 5 requests/second with burst 10 (mitigates credential stuffing).

### WebSocket Tunneling
- `Upgrade` & `Connection: "upgrade"` headers forwarded to Node.js Socket.IO server.
- `proxy_buffering off` ensures real-time slot lock/free packets propagate with zero latency.

---

## 6. Scalability & Production Readiness

1. **Horizontal Scaling**:
   - The Node.js application is stateless (JWT authentication).
   - Multiple API instances can run behind Nginx `upstream backend_upstream { server backend1:5000; server backend2:5000; }`.
   - Socket.IO scales across nodes using the Redis Pub/Sub adapter.
2. **Read vs Write Isolation**:
   - 90% of traffic (browsing doctors, checking slots, symptom search) hits Redis or indexed read queries.
   - 10% write traffic (booking, cancellation) is isolated into ACID transactions with minimal row-level lock duration.
