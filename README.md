# MediBook — Doctor Appointment Booking Platform

A full-stack web platform for booking doctor appointments — patients discover and book verified doctors (including a plain-language symptom search), doctors manage their own clinic profile and schedule, and admins verify new doctors and oversee the platform.

Built as a college project with a deliberately realistic, achievable scope — every included feature is fully implemented and handles real edge cases (concurrent booking, race-safe reference IDs, role-based access), rather than a longer list of half-finished ones.

---

## Table of Contents

- [MediBook — Doctor Appointment Booking Platform](#medibook--doctor-appointment-booking-platform)
  - [Table of Contents](#table-of-contents)
  - [Features](#features)
  - [Tech Stack](#tech-stack)
  - [Project Structure](#project-structure)
  - [Getting Started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [1. Clone and install](#1-clone-and-install)
    - [2. Create the database](#2-create-the-database)
    - [3. Configure environment variables](#3-configure-environment-variables)
    - [4. Build the schema and seed starter data](#4-build-the-schema-and-seed-starter-data)
    - [5. Run both servers](#5-run-both-servers)
  - [Environment Variables](#environment-variables)
  - [API Overview](#api-overview)
  - [Core Design Decisions](#core-design-decisions)
  - [Known Limitations](#known-limitations)

---

## Features

**Patient**
- Sign up / log in (JWT authentication)
- Symptom-based search — describe a symptom in plain words, get matched to a specialty and nearby verified doctors
- Browse / filter doctors by specialty, city, and consultation fee
- Live slot-booking grid — already-booked and already-passed slots are greyed out automatically
- Instant booking reference (e.g. `MB-20260803-004`) and clinic address on confirmation
- View, cancel appointments; leave a rating and review after a completed visit

**Doctor**
- Submit clinic details, qualifications, and license number for admin verification
- Stays hidden from patient search until approved
- Set weekly availability (days, hours, slot length)
- Confirm, complete, and add notes to appointments
- Automatically calculated earnings summary

**Admin**
- Review and approve/reject pending doctor verification requests
- View every appointment platform-wide, with full booking references
- Platform statistics — total bookings, active doctors, cancellations
- Cancel any appointment (e.g. if a doctor becomes unreachable)

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React + Vite + Tailwind CSS | Fast dev server, component reuse, custom design without heavy CSS files |
| Backend | Node.js + Express + TypeScript | Lightweight, unopinionated, compile-time type safety |
| Database | PostgreSQL | Relational data + real ACID transactions, required for the double-booking guarantee |
| DB access | `pg` (node-postgres) | Direct SQL, no ORM — every query is written and understood, not hidden behind an abstraction |
| Auth | JWT + bcryptjs | Stateless auth; bcryptjs avoids native-binary compile issues across different machines |
| Real-time | Socket.io | Live slot updates — a booked slot disappears instantly for every other patient viewing that doctor |
| Validation | zod | Runtime request validation on top of TypeScript's compile-time types |
| Maps (planned) | Leaflet + OpenStreetMap | Free, no API key/billing required |

No AI/LLM is used anywhere — symptom-to-specialty matching is a deterministic, seeded lookup table. See [Core Design Decisions](#core-design-decisions).

---

## Project Structure

```
.
├── backend/
│   ├── src/
│   │   ├── controllers/     # Business logic per feature (auth, doctor, appointment, search, review, admin)
│   │   ├── routes/          # URL → controller mapping + middleware
│   │   ├── middleware/      # JWT auth check, role guards, error handling
│   │   ├── db/               # Connection pool, schema.sql, seed.ts
│   │   ├── utils/            # datetime.ts (naive wall-clock helpers), haversine.ts
│   │   ├── sockets/          # Socket.io setup
│   │   ├── constants.ts      # Canonical specialty list
│   │   └── index.ts          # App entry point
│   ├── package.json
│   └── .env.example
│
└── frontend/
    ├── src/
    │   ├── pages/             # One file per screen (Landing, Login, DoctorSearch, DoctorProfile, dashboards)
    │   ├── components/        # Navbar, DoctorCard, ProtectedRoute, etc.
    │   ├── context/           # AuthContext (JWT + user state)
    │   ├── lib/                # api.js, socket.js, format.js, specialties.js
    │   └── index.css / tailwind.config.js
    ├── package.json
    └── .env.example
```

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org) (LTS)
- [PostgreSQL](https://www.postgresql.org/download/) running locally

### 1. Clone and install
```bash
git clone <this-repo-url>
cd <repo-folder>

cd backend && npm install
cd ../frontend && npm install
```

### 2. Create the database
```bash
psql -U postgres -c "CREATE DATABASE medibook;"
```

### 3. Configure environment variables
Copy `.env.example` → `.env` in **both** `backend/` and `frontend/`, and fill in your own values — see [Environment Variables](#environment-variables) below.

### 4. Build the schema and seed starter data
```bash
cd backend
psql -U postgres -d medibook -f src/db/schema.sql
npm run seed
```
This creates the symptom-to-specialty lookup data and a default admin account: `admin@medibook.com` / `admin123` (change this before any real use).

### 5. Run both servers
```bash
# terminal 1
cd backend && npm run dev     # http://localhost:5000

# terminal 2
cd frontend && npm run dev    # http://localhost:5173
```

Visit `http://localhost:5173`.

---

## Environment Variables

**backend/.env**
```
PORT=5000
DATABASE_URL=postgresql://username:password@localhost:5432/medibook
JWT_SECRET=a-long-random-string
CLIENT_URL=http://localhost:5173
```

**frontend/.env**
```
VITE_API_URL=http://localhost:5000
```

---

## API Overview

| Endpoint | Purpose |
|---|---|
| `POST /auth/signup`, `/auth/login` | Account creation and login |
| `GET /doctors`, `/doctors/:id` | Public doctor directory and profile (verified only) |
| `GET/PATCH /doctors/me...` | The logged-in doctor's own profile, availability, earnings |
| `GET /doctors/:id/booked-slots` | Already-taken slots, so the booking grid is accurate on load |
| `GET /search/symptom` | Symptom → specialty → nearby verified doctors |
| `POST /appointments` | Book a slot — validates verification, future time, availability window |
| `GET /appointments/mine` | The logged-in patient's or doctor's own appointments |
| `PATCH /appointments/:id/cancel`, `/complete` | Cancel or complete, ownership enforced in SQL |
| `POST /reviews` | Leave a review — only after a completed appointment |
| `/admin/...` | Doctor verification, all-appointments view, platform stats |

---

## Core Design Decisions

- **Double-booking is impossible by design**, not just by convention — `UNIQUE(doctor_id, slot_time)` is enforced at the database level, so even simultaneous requests can't both succeed.
- **Booking references are race-safe.** Each appointment gets a human-readable ID like `MB-20260803-004` (also functioning as a daily clinic token number), generated via an atomic `INSERT ... ON CONFLICT ... DO UPDATE` counter — two concurrent bookings for the same doctor on the same day can never collide.
- **No timezone bugs.** Appointment times are handled as naive wall-clock strings end-to-end — never converted through a JavaScript `Date` object or UTC on either side — avoiding a real class of bug where a booking's hour silently shifted during UTC conversion.
- **No AI for symptom matching**, deliberately — a static, seeded lookup table is explainable, reliable, and free, which matters more than flexibility for a small, enumerable mapping like symptom → specialty.

---

## Known Limitations

- No automated government license verification — admin approval is manual
- No payments, video consultations, or SMS/email reminders (intentionally out of scope)
- One clinic per doctor
- Time handling assumes India Standard Time (IST)
