# MediBook — Enterprise Doctor Appointment & Clinic Management Platform

A distributed, production-ready web platform for booking doctor appointments and managing clinic workflows. Patients discover and book verified doctors (with an intelligent symptom matcher and live slot locking), doctors manage clinics, schedules, blackout dates, and digital prescriptions, and administrators oversee credentials, appointments, and audit trails.

Engineered with comprehensive **System Design (HLD & LLD)**, an **Nginx Web Server / Reverse Proxy**, a **Redis Caching Tier**, an **Asynchronous Messaging Queue**, and **PostgreSQL ACID Transactions** guaranteeing **zero double-booking** under high concurrency.

---

## Table of Contents

- [Features](#features)
- [System Architecture (HLD & LLD)](#system-architecture-hld--lld)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start with Docker Compose](#quick-start-with-docker-compose)
- [Manual Setup](#manual-setup)
- [Environment Variables](#environment-variables)
- [API Overview](#api-overview)
- [Core Design Guarantees](#core-design-guarantees)

---

## Features

### 🧑‍⚕️ Patient
- **Symptom-Based Search**: Natural language phrase & token matching maps plain-language symptoms to verified specialist doctors.
- **Real-Time Slot Grid**: Live slot booking with WebSockets (`slot-booked` & `slot-freed`) — booked slots disable instantaneously for all active visitors.
- **Race-Safe Booking Reference**: Daily token generator (`MB-YYYYMMDD-001`) with atomic counter increments.
- **Live Notification Bell**: In-app notification center for confirmations, cancellations, reminders, and prescription readiness.
- **Digital Prescriptions**: View and print doctor-issued digital prescriptions (Rx) with clinical diagnosis, medication schedule, and instructions.
- **Directions & Ratings**: Integrated Google Maps clinic directions and post-visit doctor reviews.

### 🩺 Doctor
- **Clinic Onboarding**: Manage qualifications, license number, consultation fees, and GPS coordinates for distance-sorted search.
- **Weekly Schedule Manager**: Configure working days, start/end hours, and slot durations (10 to 60 minutes).
- **Leave & Blackout Dates**: Block emergency leaves or vacations with automated slot blocking.
- **Digital Prescription Generator**: Issue prescriptions with diagnosis, medication dosage/frequency, and patient advice.
- **Revenue Analytics**: Automated earnings calculations from completed consultations.

### 🛡️ Admin
- **Doctor Verification**: Review pending doctor applications with license details, approving or rejecting with real-time notifications.
- **Administrative Appointment Control**: Search and filter platform-wide bookings; cancel any appointment with logged reason.
- **Platform Analytics**: Total bookings, verified doctors, patient volume, and cancellation metrics cached via Redis.
- **Audit Logging**: Comprehensive system audit trail capturing administrative and critical operations.

---

## System Architecture (HLD & LLD)

> Comprehensive design specifications, sequence diagrams, and capacity estimations are documented in [`docs/SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md).

```
                               ┌─────────────────────────┐
                               │   Patients & Doctors    │
                               │     (Web Clients)       │
                               └────────────┬────────────┘
                                            │ HTTP & WebSockets
                                            ▼
                    ┌──────────────────────────────────────────────┐
                    │               NGINX WEB SERVER               │
                    │        (Reverse Proxy & Load Balancer)       │
                    │  - Rate Limiting (20r/s API, 5r/s Auth)      │
                    │  - Gzip Compression & Static Asset Caching   │
                    │  - WebSocket Upgrade Tunneling (/socket.io/) │
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
     │  - Slot Availability    │                │  - Booking Confirms     │                │  - Appointments         │
     │  - Symptom Lookups      │                │  - In-App Alerts        │                │  - Prescriptions        │
     │  - Admin Metrics        │                │  - System Audit Logs    │                │  - Daily Token Counters │
     │  - High-Speed Fallback  │                │  - Email Dispatches     │                │  - Doctor Leaves        │
     └─────────────────────────┘                └─────────────────────────┘                └─────────────────────────┘
```

### Core Architectural Patterns:
1. **Cache-Aside with Atomic Invalidation**: Reads query Redis first; booking and cancellation mutations atomically invalidate related keys (`medibook:slots:<id>`, `medibook:doctor:<id>`).
2. **Resilient In-Memory Fallback**: If Redis is temporarily offline during development, backend automatically switches to a high-speed in-memory store without failing or throwing unhandled exceptions.
3. **Decoupled Background Workers**: Long-running side-effects (notification delivery, email dispatch, audit trails) execute asynchronously via the queue.
4. **Strict Database Concurrency Guarantees**: `UNIQUE(doctor_id, slot_time)` and row-level locking via `ON CONFLICT DO UPDATE` guarantee zero double-booking and atomic token generation.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Web Server / Ingress** | Nginx | Reverse proxy, rate limiting, gzip compression, WebSocket proxy |
| **Frontend** | React 18 + Vite + Tailwind CSS | Component architecture, responsive UI, micro-animations |
| **Icons** | Lucide React | Modern medical & dashboard iconography |
| **Backend API** | Node.js + Express + TypeScript | Type-safe REST API & WebSocket event hub |
| **Database** | PostgreSQL 16 | Relational data persistence with strict ACID transaction guarantees |
| **Caching** | Redis 7 | Sub-5ms caching for doctor profiles, slots, and search results |
| **Message Queue** | Redis List / In-Memory Worker | Asynchronous job processing for notifications and audits |
| **Real-time** | Socket.IO | Instant slot-locking broadcast to connected clients |
| **Validation** | Zod | Runtime request schema validation |

---

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── cache/           # Redis caching client with in-memory fallback
│   │   ├── queue/           # Asynchronous messaging queue and worker
│   │   ├── controllers/     # Auth, doctor, appointment, prescription, notification, search, admin
│   │   ├── routes/          # URL routing & middleware pipelines
│   │   ├── middleware/      # JWT verification, RBAC guard, error handler
│   │   ├── db/              # Pool, schema.sql, seed.ts
│   │   ├── sockets/         # Socket.IO slot & notification events
│   │   ├── utils/           # Naive wall-clock datetime math, Haversine formula
│   │   └── index.ts         # App entry point
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── components/      # Navbar, NotificationBell, PrescriptionModal, DoctorCard, etc.
│   │   ├── pages/           # Landing, DoctorSearch, DoctorProfile, Patient & Doctor dashboards, Admin
│   │   ├── context/         # AuthContext
│   │   └── lib/             # API client, sockets, date formatting
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
│
├── nginx/
│   ├── nginx.conf           # Production Nginx configuration
│   └── conf.d/default.conf  # Reverse proxy, rate-limiting & WebSocket rules
│
├── docs/
│   └── SYSTEM_DESIGN.md     # In-depth HLD & LLD specification document
│
└── docker-compose.yml       # Complete multi-container orchestration
```

---

## Quick Start with Docker Compose

Run the entire platform (Nginx, Backend, PostgreSQL, Redis) with a single command:

```bash
docker-compose up --build -d
```

- Web App: `http://localhost`
- API Health Check: `http://localhost/health`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

---

## Manual Setup

### Prerequisites
- Node.js (v18+)
- PostgreSQL 14+
- Redis (Optional, fallback provided)

### 1. Install Dependencies
```bash
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` in both folders:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

### 3. Setup Database & Seed Data
```bash
# In PostgreSQL
psql -U postgres -c "CREATE DATABASE medibook;"
psql -U postgres -d medibook -f backend/src/db/schema.sql

# Seed starter doctors & accounts
cd backend && npm run seed
```

**Seeded Accounts for Testing:**
- **Admin**: `admin@medibook.com` / `admin123`
- **Patient**: `patient@medibook.com` / `patient123`
- **Doctor**: `ananya.roy@medibook.com` / `doctor123`

### 4. Run Development Servers
```bash
# Terminal 1: Backend
cd backend && npm run dev     # http://localhost:5000

# Terminal 2: Frontend
cd frontend && npm run dev    # http://localhost:5173
```

---

## API Overview

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| `POST` | `/auth/signup`, `/login` | Public | Account registration & authentication |
| `GET` | `/doctors` | Public | Search verified doctors (cached in Redis) |
| `GET` | `/doctors/:id` | Public | Doctor profile, reviews, and leaves |
| `GET` | `/doctors/:id/booked-slots` | Public | Active booked slots (cached in Redis) |
| `PATCH`| `/doctors/me` | Doctor | Update clinic details & coordinates |
| `PATCH`| `/doctors/me/availability` | Doctor | Configure weekly hours & slot lengths |
| `POST` | `/doctors/me/leaves` | Doctor | Add emergency leave / blackout date |
| `GET` | `/search/symptom` | Public | Intelligent symptom-to-specialist matcher |
| `POST` | `/appointments` | Patient | Race-safe atomic slot booking |
| `GET` | `/appointments/mine` | Auth | Patient or Doctor appointments list |
| `PATCH`| `/appointments/:id/cancel` | Auth | Cancel appointment (Patient, Doctor, Admin) |
| `PATCH`| `/appointments/:id/complete`| Doctor | Mark visit complete with notes |
| `POST` | `/prescriptions` | Doctor | Issue digital Rx prescription |
| `GET` | `/prescriptions/mine` | Patient | Patient's digital prescriptions |
| `GET` | `/notifications` | Auth | In-app alerts with unread counter |
| `POST` | `/reviews` | Patient | Review completed doctor visits |
| `GET` | `/admin/stats` | Admin | Cached platform analytics |
| `GET` | `/admin/audit-logs` | Admin | View system audit trail |

---

## Core Design Guarantees

1. **Double-Booking Prevention**: Enforced at the SQL database engine via `UNIQUE(doctor_id, slot_time)`.
2. **Race-Safe Daily Tokens**: Daily counters generated atomically using `INSERT ... ON CONFLICT (doctor_id, booking_date) DO UPDATE SET last_seq = last_seq + 1 RETURNING last_seq`.
3. **No Timezone Distortion**: Wall-clock timestamp string format (`YYYY-MM-DDTHH:MM:SS`) is preserved end-to-end without UTC drift.
4. **Deterministic Symptom Matching**: Explainable, seeded clinical lookup with bi-directional and tokenized keyword matching.
