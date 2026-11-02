# Phase 8 Plan: Next.js Frontend with Accessible UI/UX & E2E Testing

## Objectives
Build a production-quality, responsive, and accessible Next.js 15 App Router web application in `apps/web` conforming to `docs/UX.md` and WCAG 2.2 AA standards.

## Design Aesthetics & Theme
- **Color Tokens**: Medical Teal (`#0D9488` / `teal-600`), Emerald for confirmation, Rose for emergency SOS, Slate for clean neutrals.
- **Typography & Motion**: Inter/Geist font scale, 4/8-pt grid, Framer Motion respecting `prefers-reduced-motion`.
- **States**: Skeleton loaders (no layout shifts), optimistic UI where safe, meaningful empty & error states with recovery actions.
- **Accessibility**: High contrast, ARIA live regions for countdowns/toasts, visible focus rings, keyboard navigability.
- **i18n**: Multilingual dictionaries for English (`en`), Hindi (`hi`), Bengali (`bn`).

## Key Screens & Components to Create
1. **Design System & Providers**:
   - `apps/web/src/components/theme-provider.tsx`
   - `apps/web/src/components/query-provider.tsx`
   - `apps/web/src/lib/utils.ts` (cn helper)
   - `apps/web/src/lib/api-client.ts` (fetcher pointing to API with auth tokens)
   - `apps/web/src/lib/i18n.ts` (localization dictionary strings for en, hi, bn)
2. **Patient Journeys**:
   - Landing page (`apps/web/src/app/page.tsx`): Value prop, symptom search, trust badges, emergency banner.
   - Doctor Search & Filters (`apps/web/src/app/doctors/page.tsx`): Specialty, fee, rating, consultation mode, available today, pg_trgm symptom search.
   - Doctor Profile & Slot Picker (`apps/web/src/app/doctors/[id]/page.tsx`): Bio, credentials, reviews, interactive slot picker, live hold countdown.
   - Checkout (`apps/web/src/app/checkout/[id]/page.tsx`): Fee breakdown in paise, Razorpay / FakeProvider simulator, payment processing, retry states.
   - Booking Confirmation (`apps/web/src/app/appointments/[id]/confirmed/page.tsx`): Reference `MB-YYYYMMDD-NNN`, calendar invite, directions/join link.
   - My Appointments (`apps/web/src/app/appointments/page.tsx`): Upcoming and past appointments, cancel with refund policy preview, reschedule.
3. **Telehealth Consultation Room**:
   - Consultation Room (`apps/web/src/app/consultation/[id]/page.tsx`):
     - Device check (mic/camera toggle and preview).
     - Telemedicine consent modal with audit timestamp.
     - Split-screen video grid (LiveKit participant view) + real-time chat side-panel with typing indicator & attachment preview.
     - Prescription viewer & download.
4. **Emergency Ambulance Dispatch**:
   - Emergency Screen (`apps/web/src/app/emergency/page.tsx`):
     - Unmistakable SOS button, one-tap location capture, click-to-call 112 / 108.
     - Nearby hospitals list with trauma level.
     - Live driver tracking with status timeline (`REQUESTED -> OFFERED -> ACCEPTED -> EN_ROUTE -> ARRIVED`), Leaflet OSM map and ETA countdown.
5. **Doctor Workspace**:
   - Doctor Dashboard (`apps/web/src/app/doctor/dashboard/page.tsx`):
     - Today's appointment queue with 1-click consultation join.
     - Availability & leave manager with dry-run orphan booking impact preview.
     - Earnings summary with Recharts.
     - AI Clinical Copilot draft note drawer.
6. **Admin Portal**:
   - Admin Dashboard (`apps/web/src/app/admin/page.tsx`):
     - Doctor verification queue with license check and audit log review.
     - Payments, double-entry ledger explorer, and reconciliation trigger.
7. **AI Assistant Drawer**:
   - Persistent floating drawer (`apps/web/src/components/ai-drawer.tsx`):
     - Streaming conversational triage and Q&A.
     - Citation chips linking to clinical references.
     - Emergency card takeover when critical symptoms are flagged.
     - "Book Doctor" tool action buttons.

## Tests to Implement
1. **Playwright E2E Suite**:
   - `e2e/patient-flow.spec.ts`: Search doctor -> Hold slot -> Checkout -> Confirm -> Join consult.
   - `e2e/emergency-flow.spec.ts`: SOS request -> Driver accept -> Live ETA tracking.
   - `e2e/accessibility.spec.ts`: Axe-core WCAG 2.2 AA audit on landing, doctor search, and checkout.
2. **Component & Verification Gate**:
   - Unit tests for slot holding countdown, fee calculations, and emergency triggers.
   - `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
