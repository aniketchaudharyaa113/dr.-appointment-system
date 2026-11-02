# MediBook UX/UI Design System & Experience Architecture

## 1. User Personas

### 1.1 Anita Roy (Patient)
- **Profile**: 34-year-old marketing professional living in Kolkata. Caring for elderly parents with chronic hypertension.
- **Goals**: Quickly find a reputable cardiologist with clear fees, book a reliable teleconsultation slot, pay seamlessly via UPI, and receive an official digital prescription that her neighborhood pharmacy accepts.
- **Pain Points**: Confusing slot booking interfaces, fear of being double-charged, clunky video calls that disconnect on mobile 4G networks, losing paper prescriptions.
- **Key UX Need**: High trust signals, transparent pricing, countdown timers during checkout, zero-friction video joining, and clear download buttons for prescriptions.

### 1.2 Dr. Subhash Chandra (Cardiologist)
- **Profile**: 52-year-old Senior Consultant Cardiologist at Kolkata Heart Institute.
- **Goals**: Review his daily patient queue at a glance, enter teleconsultations on time, draft clinical notes quickly without typing repetitive medical instructions, and manage leave dates without accidentally leaving patients stranded.
- **Pain Points**: No-show patients, clumsy software that takes too long to type diagnoses, accidentally double-booking clinical and private hospital visits.
- **Key UX Need**: Fast keyboard shortcuts, clear day-view timeline, automated AI draft note generation, and safe leave preview workflows.

### 1.3 Vikram Singh (Emergency Ambulance Driver)
- **Profile**: 29-year-old emergency vehicle operator. Uses a mounted Android smartphone in a fast-moving ambulance.
- **Goals**: Instantly receive emergency alerts with clear pickup addresses, accept offers with a single large tap, view the fastest route without fiddling with small buttons, and mark status updates with minimal cognitive distraction.
- **Pain Points**: Tiny UI touch targets, missed notifications, slow loading maps, complicated multi-step confirmation screens.
- **Key UX Need**: High-contrast dark mode, giant 64px tap targets, audio alerts, clear distance/ETA metrics, and one-tap status toggling.

### 1.4 Priya Nair (Clinical Operations Admin)
- **Profile**: 28-year-old hospital administrator and compliance officer.
- **Goals**: Verify submitted medical credentials of newly registered doctors against government medical council registries, audit PHI access logs, inspect unsettled payments, and ensure queue workers are healthy.
- **Pain Points**: Fragmented admin interfaces, lack of auditability, manual reconciliation of failed payments.
- **Key UX Need**: Dense data tables, keyboard search, side-by-side license PDF preview, direct links to BullMQ job inspection, and one-click reconciliation tools.

---

## 2. Top User Journeys

### Journey 1: Patient Symptom Search to Confirmed Booking
1. **Landing Page**: Patient types "chest tightness" into the hero search input. Trigram search suggests *Cardiology*.
2. **Search Results**: Filtered list of verified cardiologists displayed with next-available slot badges, fees in ₹, and consultation mode chips (Video / In-Clinic).
3. **Doctor Profile**: Patient reviews qualifications, clinic address, reviews, and interactive weekly slot picker.
4. **Hold Slot**: Patient taps 10:30 AM tomorrow. Slot turns into an active 10-minute hold with a calm amber countdown banner: *"Slot held for 09:59 minutes"*.
5. **Checkout**: Clean price breakdown (Consultation Fee + Platform Fee = Total). Patient selects Razorpay (UPI/Card).
6. **Confirmation Screen**: Live confetti, booking reference token `MB-20270115-001`, "Add to Google Calendar", and "Test Camera & Audio" button.

### Journey 2: Live Video Consultation & Prescription Issuance
1. **Join Window (-10 min)**: Patient enters Waiting Room. Camera/mic self-preview check runs automatically.
2. **Doctor Admits**: Doctor clicks "Start Consultation". LiveKit WebRTC peer connection initializes in under 500ms.
3. **During Call**: Clean split screen. Left side: low-latency HD video with mute/camera/screen-share controls. Right side: collapsible medical notes pane and real-time chat with file attachment support.
4. **AI Copilot Assist**: As doctor and patient discuss symptoms, doctor clicks "Generate Draft Note". AI summarizes transcript into Diagnosis, Rx, and Lifestyle Advice. Doctor reviews, edits, and approves.
5. **Session Wrap-Up**: Doctor clicks "Complete & Issue Prescription". PDF is generated and cryptographically signed. Patient receives instant notification with prescription preview.

### Journey 3: Emergency Ambulance Dispatch
1. **Emergency Entry**: High-contrast, unmistakable red SOS button accessible from any screen header.
2. **One-Tap Location**: Browser GPS acquires current coordinates. Big button: *"Dispatch Nearest Ambulance"*.
3. **Backup Options**: Prominent click-to-call **112** (and local **108**) banner in case network drops.
4. **Driver Acceptance**: Nearest driver receives full-screen alert with 20s countdown. Driver taps *"Accept"*.
5. **Live Tracking**: Patient sees Leaflet OpenStreetMap with real-time driver vehicle pin updating every 3 seconds, dynamic ETA in minutes, and driver call button.

---

## 3. Information Architecture

```
/ (Landing Page - Hero search, specialties, emergency CTA, trust stats)
├── /search (Doctor directory, filters: specialty, fee, distance, mode, rating)
├── /doctors/:id (Doctor profile, credentials, reviews, interactive slot grid)
├── /checkout/:holdId (Payment summary, Razorpay embed, hold countdown)
├── /appointments/confirmation/:ref (Success card, directions, calendar)
├── /dashboard (Role-based redirect)
│   ├── /dashboard/patient
│   │   ├── /appointments (Upcoming, past, reschedule, cancel)
│   │   ├── /prescriptions (List, view, download PDF)
│   │   └── /consultation/:id (Waiting room, video call, chat panel)
│   ├── /dashboard/doctor
│   │   ├── /queue (Today's patients, next up, one-click join)
│   │   ├── /availability (Working hours, slot duration, leave calendar)
│   │   └── /earnings (Settled payouts, Recharts income trends)
│   ├── /dashboard/admin
│   │   ├── /verifications (Doctor license approval queue)
│   │   ├── /audit-logs (PHI access, financial event audits)
│   │   └── /reconciliation (Discrepancy resolver, BullMQ status)
│   └── /dashboard/ambulance (Driver telemetry toggle, live emergency card)
└── /emergency (Full-screen SOS, 112 emergency call, dispatch tracker)
```

---

## 4. Design Tokens & Styling System

The visual design system embodies **clinical calm, precision, and modern accessibility**.

### 4.1 Color Palette
- **Primary Brand (Teal/Emerald - Trust & Health)**:
  - `primary-50`: `#f0fdf9`
  - `primary-100`: `#ccfbf1`
  - `primary-500`: `#14b8a6`
  - `primary-600`: `#0d9488` (Main brand color, WCAG 4.5:1 compliant on white)
  - `primary-700`: `#0f766e`
  - `primary-900`: `#134e4a`
- **Emergency Accent (Crimson - Urgency & Immediate Action)**:
  - `danger-50`: `#fef2f2`
  - `danger-500`: `#ef4444`
  - `danger-600`: `#dc2626`
  - `danger-700`: `#b91c1c`
- **Neutral Surface & Text (Calm Slate)**:
  - `slate-50`: `#f8fafc` (Page background light)
  - `slate-100`: `#f1f5f9` (Card border light)
  - `slate-800`: `#1e293b` (Text secondary)
  - `slate-900`: `#0f172a` (Text primary light)
  - `dark-bg`: `#090d16` (Deep slate background dark mode)
  - `dark-card`: `#111827` (Card surface dark mode)
  - `dark-border`: `#1f2937`
- **Status Semantic**:
  - `success`: `#10b981` (Confirmed, Captured)
  - `warning`: `#f59e0b` (Held, Waiting Room)
  - `info`: `#3b82f6` (Offered, In Transit)

### 4.2 Typography Scale
Font Family: **Inter** or system sans-serif fallback. High legibility for numeric values and clinical terms.
- `text-xs`: 12px (Line height: 16px) - Micro labels, metadata badges.
- `text-sm`: 14px (Line height: 20px) - Body text secondary, form hints.
- `text-base`: 16px (Line height: 24px) - Default body copy, inputs.
- `text-lg`: 18px (Line height: 28px) - Section headers, card titles.
- `text-xl`: 20px (Line height: 28px) - Modal titles, doctor names.
- `text-2xl`: 24px (Line height: 32px) - Page titles.
- `text-3xl`: 30px (Line height: 36px) - Hero headlines.

### 4.3 Spacing & Layout
- Strictly based on an **8-point grid** (with 4px increments for micro-spacing):
  - `space-1`: 4px | `space-2`: 8px | `space-3`: 12px | `space-4`: 16px
  - `space-6`: 24px | `space-8`: 32px | `space-12`: 48px | `space-16`: 64px
- **Border Radii**:
  - `rounded-lg`: 8px (Buttons, input fields)
  - `rounded-xl`: 12px (Cards, modal dialogs)
  - `rounded-2xl`: 16px (Hero containers, emergency panels)
- **Shadows**:
  - `shadow-sm`: Subtle border lift for inputs
  - `shadow-md`: Standard card elevation
  - `shadow-xl`: Modal overlays and floating chat drawer

### 4.4 Motion & Transitions
- Respect `prefers-reduced-motion: reduce` across all animations.
- Interactive transitions: `transition-all duration-200 ease-in-out`.
- Toast & Modal transitions: Framer Motion spring presets with subtle opacity and scale transitions.

---

## 5. Component Inventory
Built on top of customizable **shadcn/ui** primitives:
1. **DoctorCard**: Specialty badge, consultation fee in paise formatted to ₹, rating stars, next available slot button.
2. **SlotGridPicker**: Date carousel selector, morning/afternoon/evening grouped slots, disabled/held/booked visual states.
3. **HoldCountdownBanner**: Sticky countdown bar displaying remaining hold time with aria-live updates.
4. **PriceBreakdownCard**: Itemized table (Consultation, Platform charge, Taxes, Total) with secure Razorpay guarantee badge.
5. **VideoConsultationRoom**: Split screen WebRTC frame with device toggle bar, network quality pill, and floating chat drawer.
6. **PrescriptionViewer**: Accessible formatted view of medicines, dosages, instructions, and instant "Download PDF" action.
7. **EmergencySOSButton**: Floating crimson beacon with high-contrast icon and instant vibration/tap feedback.
8. **LiveTrackingMap**: Leaflet OSM map container with custom ambulance icon, pulsating patient marker, and polyline route.
9. **AiChatDrawer**: Floating assistant panel with markdown rendering, source citation chips, and quick-action buttons.

---

## 6. Empty, Loading, and Error State Rules
- **Loading States**: Never show blank screens or generic unstyled spinners. Always use Tailwind animated skeletons matching the exact geometry of the incoming content (`h-12 w-full animate-pulse rounded-lg bg-slate-200`).
- **Empty States**: Every empty list (no appointments, no search results, no notifications) must present:
  1. An intuitive Lucide icon (e.g. `CalendarX`, `SearchX`).
  2. A reassuring heading (e.g., *"No appointments scheduled"*).
  3. Actionable guidance (e.g., *"Find a specialist or book a follow-up consultation"*).
  4. A primary call-to-action button (e.g., *"Browse Doctors"*).
- **Error States**: Inline form errors display in crimson with an alert circle icon and descriptive recovery advice. Network/server errors provide a *"Retry Request"* button and request-id for audit support.

---

## 7. Accessibility Rules (WCAG 2.2 AA Compliance)
1. **Color Contrast**: All text elements adhere to a minimum 4.5:1 contrast ratio against their respective backgrounds (3:1 for large text).
2. **Keyboard Navigation**: Full application can be navigated using Tab, Enter, Space, and Esc. Focus rings (`focus-visible:ring-2 focus-visible:ring-primary-500`) are prominent and never hidden.
3. **ARIA Live Regions**: Dynamic countdown timers, incoming chat messages, and ambulance ETA updates use `aria-live="polite"` so screen readers announce changes without interrupting user activity.
4. **Touch Targets**: Minimum interactive touch target size of 44×44px across all buttons, tabs, and form inputs (64×64px on Ambulance mobile UI).
5. **Internationalization (i18n)**: All UI strings externalized into JSON dictionaries for English, Hindi, and Bengali with zero hardcoded strings. RTL-friendly structure.
