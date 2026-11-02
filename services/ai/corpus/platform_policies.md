# MediBook Platform Policies & Operations
Source: MediBook Engineering & Clinical Operations Standard
License: Proprietary / MediBook Telehealth Platform

## Appointment Scheduling & Slot Holds
- Patients select available 15-minute time slots configured by verified doctors.
- When selecting an available slot, a temporary 10-minute Redis reservation lease is granted to prevent double-booking.
- If checkout is not completed within 10 minutes, the hold expires and the slot is released to other patients or the waitlist.

## Cancellation & Refund Policies
- Cancellations requested MORE than 24 hours prior to the scheduled slot time receive a 100% full refund to the original payment source.
- Cancellations requested LESS than 24 hours prior to the scheduled slot time receive a 50% partial refund, with the remainder allocated as late-cancellation fee.
- If a doctor cancels an appointment or applies for leave, the patient ALWAYS receives a 100% full refund automatically, regardless of timing.
- Late payment after slot expiry: If a payment arrives after a hold lapsed and the slot was taken by another user, the payment engine executes an immediate 100% automated refund.

## Video Consultations
- Video consultation rooms open 10 minutes prior to the scheduled time and remain accessible up to 30 minutes past the slot time.
- Both patient and doctor must join via verified authentication tokens.
- Follow-up chat messaging remains open for 7 days post-appointment.
