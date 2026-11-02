# Phase 5 Plan: Consultation (LiveKit Video + Chat + Prescriptions)

## Objectives
1. Consultation Session State Machine:
   - Modes: `IN_CLINIC`, `VIDEO`, `CHAT`.
   - States: `SCHEDULED -> WAITING -> LIVE -> ENDED`.
   - Telemedicine consent tracking (`patientConsentGiven: boolean`, `consentTimestamp: Date`).
2. LiveKit Video Integration:
   - Server mints short-lived LiveKit JWT join tokens using `@livekit/protocol` or `livekit-server-sdk`.
   - Token security: mints ONLY for verified appointment participants (`patient` or `doctor`). Non-participants receive HTTP 403 Forbidden.
   - Join Window Enforcement: tokens are only minted within `[slotTime - 10m, slotTime + 30m]`. Requests outside the window are rejected with HTTP 400.
3. Consultation Chat Gateway:
   - WebSocket gateway using Socket.IO (Redis adapter ready).
   - Room naming: `consult:<appointmentId>`.
   - Sockets authenticate via JWT handshakes. Non-participants cannot join room or receive messages.
   - Message persistence into `messages` table with pagination.
   - Delivery/read receipts (`DELIVERED`, `READ`), typing indicators.
   - Follow-up chat window enforcement: messages allowed up to 7 days after visit completion.
4. MinIO Signed URLs for Attachments:
   - Secure signed upload/download URLs via S3/MinIO client.
   - Strict MIME type validation (PDF, JPEG, PNG) and file size cap (10MB).
   - Scope limited to consultation participants.
5. Versioned Immutable Prescriptions:
   - Allowed only after appointment status is `COMPLETED`.
   - Prescription updates create a new immutable version with pointer to previous version (`version`, `parentPrescriptionId`).
   - Every read of a prescription triggers an immutable audit log (`logPhiRead`).
6. Tests to Deliver:
   - `join-window.spec.ts`: verifies token denial before 10m window, acceptance inside window, rejection after 30m.
   - `non-participant-denied.spec.ts`: user not part of appointment is rejected from both video token minting and socket room.
   - `message-persistence-order.spec.ts`: messages persist sequentially in database with correct sender role and timestamps.
   - `signed-url-scope.spec.ts`: attachment signed URLs validate file extension and restrict access.
   - `prescription-versioning.spec.ts`: only completed appointments allow prescriptions; edits generate immutable versions with audit logs.
