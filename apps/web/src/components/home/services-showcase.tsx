'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Stethoscope,
  Video,
  HeartPulse,
  FlaskConical,
  Ambulance,
  CheckCircle2,
  ChevronRight,
  Pause,
  Play,
  ArrowRight,
  Calendar,
  Clock,
  ShieldCheck,
} from 'lucide-react';

interface Pillar {
  id: string;
  label: string;
  sublabel: string;
  badge: string;
  heading: string;
  description: string;
  bullets: string[];
  steps: string[];
  ctaLabel: string;
  ctaHref: string;
  footerNote: string;
  footerHref: string;
  icon: React.ElementType;
}

const PILLARS: Pillar[] = [
  {
    id: 'booking',
    label: 'Instant Booking',
    sublabel: 'Doctors, live slots & tokens',
    badge: 'SPECIALISTS',
    heading: 'Skip the waiting room, never the doctor.',
    description:
      'See real-time specialist availability, lock your chosen slot exclusively for 10 minutes in Redis, and walk in or join online right on time.',
    bullets: [
      'Real-time doctor & clinic schedules in IST',
      'Atomic 10-minute slot lock prevents double-booking',
      'Verified NMC license badges & patient reviews',
      'Instant booking ref & automated notifications',
    ],
    steps: ['Search', 'Pick doctor', 'Hold slot', 'Confirm'],
    ctaLabel: 'Find doctors',
    ctaHref: '/doctors',
    footerNote: 'Are you a doctor? Join CuraBridge',
    footerHref: '/auth/login',
    icon: Stethoscope,
  },
  {
    id: 'passport',
    label: 'Health Passport',
    sublabel: 'Vitals, Rx & longitudinal timeline',
    badge: 'PATIENT PASSPORT',
    heading: 'Your whole health, in your pocket.',
    description:
      'Keep every digital prescription, daily vital reading, and lab diagnostic in one chronological timeline — ready to print or share anywhere.',
    bullets: [
      'Versioned immutable digital prescriptions (PDF)',
      'Longitudinal BP, heart rate, SpO2 & glucose logs',
      'Diagnostic lab orders with clinical reference flags',
      'ABDM-ready portable patient record view',
    ],
    steps: ['Consult', 'Record vitals', 'Issue Rx', 'Track health'],
    ctaLabel: 'Open Passport',
    ctaHref: '/passport',
    footerNote: 'View past consultations & receipts',
    footerHref: '/appointments',
    icon: HeartPulse,
  },
  {
    id: 'video',
    label: 'Video & Chat',
    sublabel: 'Encrypted LiveKit HD consults',
    badge: 'TELEHEALTH ROOM',
    heading: 'Face-to-face clinical care from home.',
    description:
      'Connect cleanly via WebRTC HD video with live encrypted Socket.IO clinical chat, attachment uploads, and AI-assisted doctor SOAP notes.',
    bullets: [
      'End-to-end encrypted LiveKit consultation rooms',
      'Real-time typing & persistent 7-day follow-up chat',
      'Presigned document & scan attachment sharing',
      'Consent-first workflow compliant with India 2020 rules',
    ],
    steps: ['Book video', 'Give consent', 'Join room', 'Receive Rx'],
    ctaLabel: 'My Appointments',
    ctaHref: '/appointments',
    footerNote: 'Browse video-enabled specialists',
    footerHref: '/doctors',
    icon: Video,
  },
  {
    id: 'labs',
    label: 'Lab & Vitals',
    sublabel: 'Diagnostic orders & telemetry',
    badge: 'DIAGNOSTICS',
    heading: 'Clear diagnostic results, never buried in paper.',
    description:
      'Doctors order routine or urgent panels right inside the consult room, and completed lab metrics stream back directly to your Health Passport.',
    bullets: [
      'Doctor-ordered panels linked directly to visits',
      'Routine & urgent priority flags with prep notes',
      'Structured quantitative result values & notes',
      'Instant visibility across patient & physician portals',
    ],
    steps: ['Consult', 'Lab order', 'Test run', 'Digital report'],
    ctaLabel: 'View Health Passport',
    ctaHref: '/passport',
    footerNote: 'Doctor portal lab management',
    footerHref: '/doctor/dashboard',
    icon: FlaskConical,
  },
  {
    id: 'ems',
    label: 'Emergency EMS',
    sublabel: '24/7 dispatch & live GPS tracking',
    badge: 'PRIORITY EMS',
    heading: 'Ambulance dispatch measured in seconds.',
    description:
      'Trigger a one-tap SOS request with geolocation, match the nearest online ambulance crew automatically, and track arrival live on map.',
    bullets: [
      'Nearest driver dispatch cascade via Redis GEO',
      'Real-time ambulance telemetry on Leaflet map',
      'Direct 112 & 108 national emergency hotlines',
      'Nearby trauma centers sorted by exact distance',
    ],
    steps: ['Share GPS', 'Dispatch SOS', 'Crew accepts', 'Live tracking'],
    ctaLabel: 'Open Emergency SOS',
    ctaHref: '/emergency',
    footerNote: 'Driver dispatch portal login',
    footerHref: '/auth/login',
    icon: Ambulance,
  },
];

function PillarPreviewMockup({ activeId }: { activeId: string }) {
  if (activeId === 'booking') {
    return (
      <div className="relative space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 text-[#132238] dark:text-slate-100 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
            Live across verified clinics
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 text-[#52637A] dark:text-slate-300 shadow-sm">
            <Clock className="w-3 h-3 text-emerald-600" aria-hidden="true" />
            10-min slot hold
          </span>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 shadow-lg space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-700 text-white font-display font-bold text-sm flex items-center justify-center shrink-0">
              SC
            </div>
            <div>
              <p className="text-sm font-bold text-[#132238] dark:text-white">Dr. Subhash Chandra</p>
              <p className="text-xs text-[#52637A] dark:text-slate-400">Cardiology • Salt Lake Sector V</p>
            </div>
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[11px] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            Available today • Next 10:00 IST
          </div>
          <div className="grid grid-cols-5 gap-1.5 text-center text-[11px] font-semibold">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, idx) => (
              <div
                key={day}
                className={`py-2 rounded-xl border ${
                  idx === 0
                    ? 'bg-emerald-800 text-white border-emerald-800'
                    : 'bg-[#F6FAF8] dark:bg-[#0E1C17] text-[#52637A] dark:text-slate-300 border-[#E3ECE7] dark:border-emerald-900/50'
                }`}
              >
                <div>{day}</div>
                <span className={`block w-1.5 h-1.5 rounded-full mx-auto mt-1 ${idx === 0 ? 'bg-emerald-300' : 'bg-emerald-500'}`} />
              </div>
            ))}
          </div>
        </div>

        <div className="ml-auto max-w-[240px] p-3.5 rounded-2xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 shadow-md flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[#52637A] dark:text-slate-400 font-semibold">Booking Ref</p>
            <p className="font-mono text-base font-extrabold text-[#132238] dark:text-white">MB-004</p>
          </div>
          <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/70 px-2.5 py-1 rounded-full">
            Confirmed
          </span>
        </div>
      </div>
    );
  }

  if (activeId === 'passport') {
    return (
      <div className="relative flex justify-center">
        <div className="w-[260px] rounded-[28px] bg-[#132238] p-2.5 shadow-2xl border border-slate-700/40">
          <div className="rounded-[22px] bg-white dark:bg-[#102019] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-[#52637A] dark:text-slate-400">Good morning,</p>
                <p className="text-xs font-bold text-[#132238] dark:text-white">Anita Roy</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                ABDM Ready
              </span>
            </div>
            <div className="p-3 rounded-xl bg-emerald-700 text-white space-y-1">
              <p className="text-[10px] uppercase opacity-80">Latest Vitals</p>
              <p className="text-lg font-extrabold tabular-nums">118/76 mmHg</p>
              <p className="text-[10px] opacity-85">SpO2 99% • Pulse 72 bpm</p>
            </div>
            <div className="space-y-1.5 text-[11px]">
              <div className="p-2 rounded-lg bg-[#F5FAF7] dark:bg-[#162B22] flex items-center justify-between">
                <span className="font-semibold text-[#132238] dark:text-slate-100">Digital Rx v2</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">PDF Ready</span>
              </div>
              <div className="p-2 rounded-lg bg-[#F5FAF7] dark:bg-[#162B22] flex items-center justify-between">
                <span className="font-semibold text-[#132238] dark:text-slate-100">CBC Blood Panel</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">Completed</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (activeId === 'video') {
    return (
      <div className="p-5 rounded-2xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 shadow-lg space-y-4">
        <div className="h-36 rounded-xl bg-gradient-to-br from-[#132B23] to-[#1D4B3B] text-white p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              Encrypted LiveKit HD
            </span>
            <span className="font-mono opacity-80">14:22</span>
          </div>
          <div>
            <p className="font-bold text-sm">Dr. Priyanka Chatterjee</p>
            <p className="text-[11px] text-emerald-200/80">Pediatrics • Live Consultation</p>
          </div>
        </div>
        <div className="p-3 rounded-xl bg-[#F5FAF7] dark:bg-[#0E1C17] border border-[#E3ECE7] dark:border-emerald-900/50 space-y-1.5 text-xs">
          <p className="font-semibold text-[#132238] dark:text-white">Clinical Chat &amp; AI SOAP Draft</p>
          <p className="text-[11px] text-[#52637A] dark:text-slate-400">
            &ldquo;Prescription updated &amp; uploaded securely to your Health Passport.&rdquo;
          </p>
        </div>
      </div>
    );
  }

  if (activeId === 'labs') {
    return (
      <div className="p-5 rounded-2xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 shadow-lg space-y-3">
        <div className="flex items-center justify-between text-xs font-bold text-[#132238] dark:text-white">
          <span>Diagnostic Lab Orders</span>
          <span className="text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-full">
            2 Completed
          </span>
        </div>
        {[
          { test: 'HbA1c Glycated Hemoglobin', val: '6.4%', flag: 'Better' },
          { test: 'Fasting Blood Glucose', val: '104 mg/dL', flag: 'Normal' },
          { test: 'Lipid Profile Panel', val: '138 mg/dL', flag: 'Tracked' },
        ].map((item) => (
          <div
            key={item.test}
            className="p-3 rounded-xl bg-[#F6FAF8] dark:bg-[#0E1C17] border border-[#E3ECE7] dark:border-emerald-900/50 flex items-center justify-between text-xs"
          >
            <div>
              <p className="font-semibold text-[#132238] dark:text-slate-100">{item.test}</p>
              <p className="text-[11px] text-[#52637A] dark:text-slate-400 font-mono">{item.val}</p>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-300">
              {item.flag}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-5 rounded-2xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 shadow-lg space-y-4">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 px-2.5 py-1 rounded-full">
          <Ambulance className="w-3.5 h-3.5" aria-hidden="true" />
          Unit WB-01-AMB-112 Dispatched
        </span>
        <span className="font-mono text-xs font-extrabold text-emerald-700 dark:text-emerald-300">6 min ETA</span>
      </div>
      <div className="p-4 rounded-xl bg-[#F5FAF7] dark:bg-[#0E1C17] border border-[#E3ECE7] dark:border-emerald-900/50 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-[#52637A] dark:text-slate-400">Pickup Area</span>
          <span className="font-semibold text-[#132238] dark:text-white">Park Street, Kolkata</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[#52637A] dark:text-slate-400">Nearest Trauma Center</span>
          <span className="font-semibold text-[#132238] dark:text-white">SSKM Emergency (1.4 km)</span>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] font-medium text-[#52637A] dark:text-slate-400">
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
        <span>Live GPS coordinates streamed every 3 seconds via Socket.IO</span>
      </div>
    </div>
  );
}

export function ServicesShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  useEffect(() => {
    if (!isAutoPlaying) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % PILLARS.length);
    }, 6000);
    return () => clearInterval(timer);
  }, [isAutoPlaying]);

  const active = PILLARS[activeIndex];

  return (
    <section className="py-20 bg-[#F6FAF8] dark:bg-[#0D1A15] border-y border-[#E3ECE7] dark:border-emerald-950/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-2xl mx-auto space-y-2.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
            OUR PLATFORM
          </p>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl text-[#132238] dark:text-white tracking-tight">
            Five pillars. <span className="text-emerald-600 dark:text-emerald-400">One CuraBridge.</span>
          </h2>
          <p className="text-sm sm:text-base text-[#52637A] dark:text-slate-300">
            Select any capability below to explore how CuraBridge connects instant bookings, clinical records, and emergency care.
          </p>
          <Link
            href="/doctors"
            className="inline-flex items-center gap-1 text-xs font-bold text-[#132238] dark:text-emerald-300 hover:text-emerald-700 transition-colors pt-1"
          >
            <span>Explore live specialists</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left Accessible Tablist */}
          <div className="lg:col-span-4 space-y-2.5">
            <div role="tablist" aria-label="CuraBridge platform capabilities" className="space-y-2.5">
              {PILLARS.map((item, idx) => {
                const Icon = item.icon;
                const isSelected = idx === activeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`pillar-tab-${item.id}`}
                    aria-selected={isSelected}
                    onClick={() => {
                      setActiveIndex(idx);
                      setIsAutoPlaying(false);
                    }}
                    className={`w-full text-left p-3.5 rounded-2xl border flex items-center justify-between gap-3 transition-all ${
                      isSelected
                        ? 'bg-white dark:bg-[#12221C] border-emerald-600 shadow-[0_8px_24px_-8px_rgba(25,135,84,0.22)]'
                        : 'bg-white/75 dark:bg-[#101D18]/75 border-[#E3ECE7] dark:border-emerald-950/80 hover:border-emerald-300 dark:hover:border-emerald-800'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors ${
                          isSelected
                            ? 'bg-emerald-600 text-white'
                            : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        <Icon className="w-5 h-5" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#132238] dark:text-white truncate">
                          {item.label}
                        </p>
                        <p className="text-xs text-[#52637A] dark:text-slate-400 truncate">
                          {item.sublabel}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-emerald-600 text-white'
                          : 'text-[#52637A] dark:text-slate-400'
                      }`}
                    >
                      <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2 px-1 text-[11px] text-[#52637A] dark:text-slate-400">
              <div className="flex items-center gap-2 flex-1">
                <div className="w-16 h-1 rounded-full bg-emerald-200 dark:bg-emerald-950 overflow-hidden">
                  <div
                    className={`h-full bg-emerald-600 transition-all duration-300 ${
                      isAutoPlaying ? 'w-2/3' : 'w-full'
                    }`}
                  />
                </div>
                <span>{isAutoPlaying ? 'Auto-cycles every 6s · tap to lock' : 'Selection locked'}</span>
              </div>
              <button
                type="button"
                onClick={() => setIsAutoPlaying((p) => !p)}
                className="no-touch-target inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#E3ECE7] dark:border-emerald-900 bg-white dark:bg-[#12221C] text-[11px] font-semibold text-[#132238] dark:text-slate-200 hover:border-emerald-500"
              >
                {isAutoPlaying ? (
                  <>
                    <Pause className="w-3 h-3" aria-hidden="true" /> Pause
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3" aria-hidden="true" /> Play
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Panel */}
          <div className="lg:col-span-8">
            <div
              role="tabpanel"
              aria-labelledby={`pillar-tab-${active.id}`}
              className="rounded-3xl bg-gradient-to-br from-[#EAF6EF] via-[#F4FAF7] to-white dark:from-[#10241C] dark:via-[#0E1E17] dark:to-[#12221C] border border-[#DCEAE2] dark:border-emerald-900/70 p-6 sm:p-9 shadow-sm"
            >
              <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
                <div className="md:col-span-6 space-y-5">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white dark:bg-[#12221C] border border-[#DCEAE2] dark:border-emerald-900 text-emerald-700 dark:text-emerald-300">
                    <Calendar className="w-3 h-3" aria-hidden="true" />
                    {active.badge}
                  </span>

                  <h3 className="font-display font-extrabold text-2xl sm:text-3xl text-[#132238] dark:text-white leading-tight">
                    {active.heading}
                  </h3>

                  <p className="text-xs sm:text-sm text-[#52637A] dark:text-slate-300 leading-relaxed">
                    {active.description}
                  </p>

                  <ul className="space-y-2">
                    {active.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2 text-xs font-medium text-[#132238] dark:text-slate-200">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] font-semibold text-[#52637A] dark:text-slate-400">
                    {active.steps.map((s, idx) => (
                      <React.Fragment key={s}>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-4 h-4 rounded-full border border-emerald-400/70 text-emerald-700 dark:text-emerald-300 text-[10px] flex items-center justify-center font-bold">
                            {idx + 1}
                          </span>
                          <span>{s}</span>
                        </span>
                        {idx < active.steps.length - 1 && <span aria-hidden="true">→</span>}
                      </React.Fragment>
                    ))}
                  </div>

                  <div className="pt-1 space-y-2">
                    <Link
                      href={active.ctaHref}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#198754] hover:bg-[#146C43] text-white text-xs sm:text-sm font-bold shadow-sm transition-colors"
                    >
                      <span>{active.ctaLabel}</span>
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </Link>
                    <div>
                      <Link
                        href={active.footerHref}
                        className="text-[11px] font-semibold text-[#52637A] dark:text-slate-400 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors"
                      >
                        {active.footerNote} →
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-6">
                  <PillarPreviewMockup activeId={active.id} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
