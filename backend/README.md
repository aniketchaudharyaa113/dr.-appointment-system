# MediBook Backend

Express + TypeScript + PostgreSQL backend for the doctor appointment platform.
No AI/LLM APIs are used anywhere in this codebase.

## Recent correctness fixes (read this if you're upgrading an existing install)

1. **Symptom search matching nothing:** `specialty` used to be free text, so a doctor typing "Dental" instead of "Dentist" silently broke the exact-match lookup against `symptom_specialty_map`. Fixed by constraining `specialty` to a canonical list (`src/constants.ts`), validated with zod on every profile update, plus the matching query switched from `=` to `ILIKE` as a second layer of defense. **If you already have a doctor profile saved with an old free-text specialty, you need to re-save it through the new dropdown on the frontend** — this fix prevents new bad data, it doesn't retroactively repair old rows.
2. **Correct bookings rejected as "outside available hours":** the frontend built slot times with `toISOString()` (which converts to UTC) but sent the string without the `Z` that marks it as UTC. The backend then re-parsed that string as if it were already local time — silently shifting every booking by IST's +5:30 offset. Fixed by treating appointment times as naive wall-clock strings end-to-end (see `src/utils/datetime.ts`) — no `Date` object is ever constructed from a slot time, on either side, so there's nothing to shift. Also switched `pg`'s type parser (`src/db/pool.ts`) to return raw strings for `TIMESTAMP` columns instead of auto-converting them into (timezone-ambiguous) `Date` objects.
3. **Public doctor profile leaking phone/email:** `GET /doctors` and `GET /doctors/:id` were returning the doctor's personal phone number and email to any unauthenticated visitor. Fixed — only `GET /doctors/me` (the doctor's own authenticated view) returns that now.
4. **RBAC:** admins can now cancel any appointment (previously only the patient or doctor on it could) — useful if a doctor is unreachable and the platform needs to intervene.

## Setup

```bash
npm install
cp .env.example .env        # then fill in your real DATABASE_URL and JWT_SECRET

# create the database first, e.g.:
#   createdb medibook
psql -U your_username -d medibook -f src/db/schema.sql

npm run seed                # seeds symptom->specialty data + a default admin
npm run dev                 # starts the dev server with auto-reload
```

Default admin login (created by the seed script): `admin@medibook.com` / `admin123` — change this password immediately in a real setting.

## Schema — what each table is for

- **users** — every account (patient, doctor, or admin) lives here. `role` decides what they can do.
- **doctors** — a 1:1 extension of a user row, only present for doctor accounts. Holds clinic info, fee, specialty, and `is_verified` (false until admin approves).
- **availability** — a doctor's weekly working hours, used to generate bookable slots on the frontend.
- **appointments** — the booking itself. `UNIQUE (doctor_id, slot_time)` guarantees the same doctor can never have two appointments at the same time, even under concurrent requests. `booking_ref` is a human-readable reference like `MB-20260803-004` (MediBook, appointment date, that doctor's 4th booking that day) — generated atomically alongside the booking, see `doctor_daily_counters` below.
- **doctor_daily_counters** — tracks the last token number issued per doctor per day. `createAppointment` increments this with an atomic `ON CONFLICT ... DO UPDATE`, inside the same transaction as the appointment insert, so two concurrent bookings for the same doctor on the same day can never be issued the same reference number, and a failed booking never wastes a number (the whole transaction rolls back together).
- **reviews** — a rating linked to a doctor and patient, only allowed after a completed appointment (enforced in the controller).
- **symptom_specialty_map** — a static lookup table, not AI. Seeded once with common symptom-to-specialty pairs.

## If you already have a database from before

Run this against your existing DB to add the new table/column without losing data:
```sql
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS booking_ref VARCHAR(20) UNIQUE;

CREATE TABLE IF NOT EXISTS doctor_daily_counters (
  doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
  booking_date DATE NOT NULL,
  last_seq INT NOT NULL DEFAULT 0,
  PRIMARY KEY (doctor_id, booking_date)
);
```
Existing appointments booked before this change will have `booking_ref = NULL` — that's fine, they're historical records, only new bookings get a reference.

## Routes — what each one does

### `/auth`
- `POST /auth/signup` — creates a user. If `role: "DOCTOR"` is sent, it also creates a blank `doctors` row for them to fill in later via `/doctors/me`.
- `POST /auth/login` — checks email/password, returns a JWT valid for 7 days.

### `/doctors`
- `GET /doctors` — public list, filterable by `specialty`, `city`, `maxFee`. Only returns `is_verified = true` doctors.
- `GET /doctors/:id` — full profile with availability and reviews attached. Public, but only returns verified doctors (matches the "not bookable until approved" rule).
- `GET /doctors/me` — the logged-in doctor's own profile, including while still unverified. This is how the doctor dashboard loads data before admin approval, since `/doctors/:id` won't return an unverified doctor. Requires a valid JWT with role `DOCTOR`.
- `PATCH /doctors/me` — the logged-in doctor fills in/updates their own profile (clinic, fee, license number, etc). Requires a valid JWT with role `DOCTOR`.
- `PATCH /doctors/me/availability` — replaces the doctor's weekly schedule.
- `GET /doctors/me/earnings` — sums the consultation fee across all of that doctor's `COMPLETED` appointments.

### `/appointments`
- `POST /appointments` — books a slot. Relies on the DB's unique constraint to reject double-bookings; if that happens, the client gets a `409 Conflict` with a clear message instead of a confusing 500 error. On success, it emits a `slot-booked` Socket.io event so anyone else looking at that doctor's page sees the slot disappear live.
- `GET /appointments/mine` — returns different data depending on whether the logged-in user is a patient or a doctor (checked via `req.user.role`, set by the auth middleware).
- `PATCH /appointments/:id/cancel` — either the patient or the doctor on that appointment can cancel it; ownership is checked in the SQL itself, not just in application code.
- `PATCH /appointments/:id/complete` — doctor-only, marks a visit done and can attach notes.

### `/search`
- `GET /search/symptom?q=chest%20pain&lat=..&lng=..` — looks up the symptom in `symptom_specialty_map`, queries verified doctors of that specialty, and if `lat`/`lng` are provided (from the browser's Geolocation API), sorts them by distance using the Haversine formula in `utils/haversine.ts`. No external API is called for this — it's plain math against coordinates you already stored when the doctor filled in their clinic address.

### `/reviews`
- `POST /reviews` — before inserting, checks the patient actually has a `COMPLETED` appointment with that doctor. Prevents reviews from people who never had an appointment.

### `/admin`
Every route here is behind `verifyToken` + `requireRole("ADMIN")`, applied once at the top of the router with `router.use(...)` so you don't have to repeat it on every route.
- `GET /admin/doctors/pending` — doctors awaiting verification.
- `PATCH /admin/doctors/:id/verify` — approve or reject (`{ approve: true }` or `{ approve: false }`).
- `GET /admin/appointments` — every appointment on the platform.
- `GET /admin/stats` — total bookings, active (verified) doctors, cancellation count.

## How auth works end-to-end

1. `POST /auth/login` returns a JWT containing `{ id, role }`, signed with `JWT_SECRET`.
2. The frontend stores this token and sends it as `Authorization: Bearer <token>` on every request that needs it.
3. `verifyToken` middleware decodes it and attaches `{ id, role }` to `req.user`.
4. `requireRole("DOCTOR")` (or `"ADMIN"`, etc.) checks `req.user.role` and blocks the request with a 403 if it doesn't match.

This is why controllers can trust `req.user!.id` — by the time a controller runs, `verifyToken` has already guaranteed it's a valid, non-expired token.

## Security notes before you push this to GitHub

- `.env` is now git-ignored and `.env.example` is provided as the template — but the `.env` in this project folder already has a real `JWT_SECRET` value in it from local dev. Generate a fresh one (`openssl rand -hex 64`) before treating this as a secret you're comfortable with, and never commit `.env` itself.
- The seeded default admin (`admin@medibook.com` / `admin123`) should have its password changed if this ever runs anywhere other than your own machine for a demo.

## Next steps

- Build the React frontend against these exact routes.
- `zod` validation is now in place for signup and review submission; extend the same pattern (`schema.safeParse(req.body)`) to the remaining controllers (doctor profile updates, availability) as you touch them.
- Consider rate-limiting `/auth/login` against brute-force attempts before treating this as demo-ready.
