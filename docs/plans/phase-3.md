# Phase 3 Execution Plan: Scheduling Core

## 1. Objectives
Implement the complete scheduling engine embodying all 10 domain rules from §6:
1. Zero double-booking via partial unique index `(doctor_id, slot_time) WHERE status IN ('PENDING_PAYMENT', 'CONFIRMED')`.
2. Slot grid alignment to doctor's configured working windows and duration blocks (e.g. 15, 30, 60 min).
3. Wall-clock time in clinic timezone (`Asia/Kolkata`) with zero UTC drift.
4. Daily atomic booking reference generator `MB-YYYYMMDD-NNN` using `doctor_daily_counters` with row-level locks.
5. Slot hold in Redis (10 min TTL) with WebSocket broadcast.
6. Doctor leaves with dry-run conflict detection, cascading cancellation with auto-refunds, and patient notification outbox events.
7. Waitlist queue with 15-minute claim offer cascade when slots are cancelled.
8. Trigram search (`pg_trgm`) for symptom-to-specialty mapping and multi-facet filtering (specialty, fee, rating, distance, consultation mode).

---

## 2. Modules & Files to Create
1. **Scheduling Module** (`apps/api/src/modules/scheduling/`):
   - `scheduling.module.ts`
   - `services/doctor.service.ts`: Doctor search (trigram & filters), profile management
   - `services/slot.service.ts`: Slot grid generation, working window calculations, cached next-available slot
   - `services/booking.service.ts`: Atomic slot hold (Redis), booking confirmation with partial unique index, reference sequence generation, cancel and atomic reschedule
   - `services/leave.service.ts`: Leave dry-run preview, atomic leave creation with cascading cancellation and notification outbox entries
   - `services/waitlist.service.ts`: Waitlist joining, slot cancellation offer dispatch with 15-minute claim window, expiry relay
   - `controllers/doctor.controller.ts`: `/api/doctors`, `/api/doctors/:id`, `/api/doctors/:id/slots`
   - `controllers/appointment.controller.ts`: `/api/appointments/hold`, `/api/appointments/book`, `/api/appointments/:id/cancel`, `/api/appointments/:id/reschedule`
   - `controllers/waitlist.controller.ts`: `/api/waitlists`, `/api/waitlists/claim`
   - `gateways/slot-events.gateway.ts`: WebSocket gateway emitting slot status changes (`slot:held`, `slot:released`, `slot:booked`)

---

## 3. Risks & Mitigations
- **Double Booking Race Condition**: 50 parallel requests for the same slot.
  *Mitigation: Redis hold NX lock + partial unique index in PostgreSQL ensures exactly 1 winner commits; 49 receive 409 Conflict.*
- **Reference Number Race**: Two simultaneous bookings generate the same daily reference `MB-YYYYMMDD-001`.
  *Mitigation: Atomic `INSERT ... ON CONFLICT (doctor_id, booking_date) DO UPDATE SET last_seq = doctor_daily_counters.last_seq + 1 RETURNING last_seq` inside the transaction.*
- **Leave Orphaned Bookings**: A doctor applies for leave while 10 patients are booked.
  *Mitigation: `LeaveService.previewLeaveImpact()` shows affected bookings. Confirmation cancels them atomically with 100% refund outbox jobs.*

---

## 4. Tests to Write
1. `apps/api/test/concurrency-booking.spec.ts`: 50 concurrent parallel booking requests for the same slot (proves exactly 1 succeeds, 49 conflict).
2. `apps/api/test/cancel-rebook.spec.ts`: Cancel an appointment and immediately rebook the freed slot.
3. `apps/api/test/slot-grid.spec.ts`: Generates slot grid and validates slot bounds, duration alignment, and timezone accuracy.
4. `apps/api/test/leave-cascade.spec.ts`: Doctor leave cancels active bookings and generates refund events.
5. `apps/api/test/hold-expiry.spec.ts`: Held slot releases automatically upon TTL expiration.
6. `apps/api/test/waitlist-offer-chain.spec.ts`: Cancelled slot automatically triggers claim offer to the next waitlisted patient.
