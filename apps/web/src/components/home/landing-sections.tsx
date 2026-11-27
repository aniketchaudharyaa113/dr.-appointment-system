'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { fetchApi } from '@/lib/api';
import {
  ShieldAlert,
  QrCode,
  Activity,
  Lock,
  ArrowRight,
  CheckCircle2,
  UserPlus,
  Search,
  CalendarCheck,
  FileCheck2,
  MapPin,
  Clock,
  Star,
  Stethoscope,
  Ambulance,
  ShieldCheck,
  Users,
  HeartPulse,
  PhoneCall,
} from 'lucide-react';

interface LiveDoctorCard {
  id: string;
  name: string;
  specialty: string;
  clinicName?: string | null;
  clinicAddress?: string | null;
  experienceYears: number;
}

const PREVIEW_SCREENS = [
  {
    id: 'appointments',
    label: 'Appointments',
    sub: 'Every booking, hold & status',
    num: '01 / 04',
    title: 'Appointments',
    desc: 'Video, live chat, and clinic consultations in one chronological queue — with slot hold timers, receipts, and direct room access.',
    checks: [
      'Filter upcoming, completed & cancelled visits',
      'Instant cancellation with automated policy refunds',
      'One-tap join for LiveKit video or chat room',
    ],
  },
  {
    id: 'vitals',
    label: 'Daily Vitals',
    sub: 'BP, heart rate, SpO2 & glucose',
    num: '02 / 04',
    title: 'Vitals Telemetry',
    desc: 'Track systolic/diastolic BP, oxygen saturation, temperature, and fasting glucose directly alongside consultation history.',
    checks: [
      'Synced live with physician consultation view',
      'Clean baseline history without noisy charts',
      'Automated flagging when readings need attention',
    ],
  },
  {
    id: 'passport',
    label: 'Health Records',
    sub: 'Prescriptions & lab orders',
    num: '03 / 04',
    title: 'Health Passport',
    desc: 'Versioned digital prescriptions, medication dosages, and completed diagnostic lab reports preserved cleanly in one printable view.',
    checks: [
      'Immutable Rx versioning with doctor license ID',
      'Printable clinical summary for offline visits',
      'ABDM-ready portable longitudinal view',
    ],
  },
  {
    id: 'ems',
    label: 'Emergency EMS',
    sub: 'Live ambulance GPS dispatch',
    num: '04 / 04',
    title: 'Priority Dispatch',
    desc: 'Broadcast an SOS location alert to nearby online ambulance crews and watch live vehicle telemetry approach on an interactive map.',
    checks: [
      'Automated 20-second driver dispatch cascade',
      'Nearest trauma centers ranked by Haversine distance',
      'Direct 112 / 108 emergency call shortcuts',
    ],
  },
];

export function EmergencyCardSpotlight() {
  return (
    <section className="py-20 bg-white dark:bg-[#091310]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        {/* Visual Card Left */}
        <div className="lg:col-span-6">
          <div className="p-6 sm:p-10 rounded-3xl bg-[#FDEEEF] dark:bg-[#231215] border border-rose-200/70 dark:border-rose-950/70 relative">
            <div className="rounded-2xl bg-white dark:bg-[#141A22] border border-rose-200/80 dark:border-rose-900/50 shadow-xl overflow-hidden">
              <div className="px-5 py-3 bg-[#C82333] text-white flex items-center justify-between text-xs font-bold">
                <span className="inline-flex items-center gap-1.5">
                  <HeartPulse className="w-4 h-4" aria-hidden="true" />
                  EMERGENCY HEALTH ID
                </span>
                <span className="opacity-90">CuraBridge</span>
              </div>
              <div className="p-5 grid grid-cols-1 sm:grid-cols-12 gap-5 items-center">
                <div className="sm:col-span-8 space-y-3">
                  <div>
                    <p className="font-display font-extrabold text-base text-[#132238] dark:text-white">Anita Roy</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-extrabold">
                        O+ Blood
                      </span>
                      <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[#132238] dark:text-slate-200 text-xs font-semibold">
                        Age 34
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] space-y-1 text-[#52637A] dark:text-slate-300">
                    <p>
                      <span className="font-bold text-[#132238] dark:text-white">Allergies:</span> Penicillin
                    </p>
                    <p>
                      <span className="font-bold text-[#132238] dark:text-white">Conditions:</span> Mild Asthma
                    </p>
                    <p>
                      <span className="font-bold text-[#132238] dark:text-white">SOS Contact:</span> +91 98XXX XX210
                    </p>
                  </div>
                </div>
                <div className="sm:col-span-4 flex flex-col items-center justify-center p-3 rounded-xl bg-[#F8FAF9] dark:bg-[#0D1418] border border-slate-200 dark:border-slate-800">
                  <QrCode className="w-16 h-16 text-[#132238] dark:text-white" aria-hidden="true" />
                  <span className="text-[9px] font-bold text-rose-600 dark:text-rose-400 mt-1">
                    SOS PASSPORT
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 sm:mt-0 sm:absolute sm:bottom-5 sm:right-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900 shadow-lg text-[11px] font-semibold text-[#132238] dark:text-slate-100">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" aria-hidden="true" />
              <span>EMS Dispatched · Live GPS ETA 6 min</span>
            </div>
          </div>
        </div>

        {/* Copy Right */}
        <div className="lg:col-span-6 space-y-6">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-900/70">
            <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
            Emergency Dispatch &amp; Health ID
          </span>

          <h2 className="font-display font-extrabold text-3xl sm:text-4xl text-[#132238] dark:text-white leading-tight tracking-tight">
            Your health info &amp; EMS dispatch, ready in seconds.
          </h2>

          <p className="text-sm sm:text-base text-[#52637A] dark:text-slate-300 leading-relaxed">
            In an urgent clinical moment, every second matters. Request the nearest ambulance with live GPS tracking while keeping critical vitals and allergies accessible.
          </p>

          <div className="space-y-4">
            {[
              {
                icon: Ambulance,
                title: 'Real-time ambulance dispatch cascade',
                body: 'Matches the closest active crew via Redis geospatial search with live location updates.',
              },
              {
                icon: Activity,
                title: 'Life-saving essentials in one view',
                body: 'Blood group, latest vitals telemetry, prescriptions, and lab orders inside your Passport.',
              },
              {
                icon: PhoneCall,
                title: 'Verified national 112 & 108 shortcuts',
                body: 'Immediate direct dial buttons plus nearby trauma centers ranked by distance.',
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex items-start gap-3.5">
                  <span className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-200/70 dark:border-rose-900/60 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-[#132238] dark:text-white">{item.title}</p>
                    <p className="text-xs text-[#52637A] dark:text-slate-400 mt-0.5">{item.body}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              href="/emergency"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors"
            >
              <span>Launch Emergency SOS</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
            <Link
              href="/passport"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-[#E3ECE7] dark:border-emerald-900 bg-white dark:bg-[#12221C] hover:border-emerald-500 text-[#132238] dark:text-white text-xs sm:text-sm font-semibold transition-colors"
            >
              <span>View Health Passport</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function InsidePlatformShowcase() {
  const [activeIdx, setActiveIdx] = useState(0);
  const current = PREVIEW_SCREENS[activeIdx];

  return (
    <section className="py-20 bg-[#F6FAF8] dark:bg-[#0D1A15] border-y border-[#E3ECE7] dark:border-emerald-950/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-2xl mx-auto space-y-2.5">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
            INSIDE CURABRIDGE
          </p>
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl text-[#132238] dark:text-white tracking-tight">
            Every record. Every reading.{' '}
            <span className="text-emerald-600 dark:text-emerald-400">One workspace.</span>
          </h2>
          <p className="text-sm sm:text-base text-[#52637A] dark:text-slate-300">
            Book visits, track vitals, join HD video consults, and access verified lab orders seamlessly on desktop or mobile.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left selector */}
          <div className="lg:col-span-4 space-y-2.5" role="tablist" aria-label="Workspace previews">
            {PREVIEW_SCREENS.map((scr, idx) => {
              const selected = idx === activeIdx;
              return (
                <button
                  key={scr.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveIdx(idx)}
                  className={`w-full text-left p-3.5 rounded-2xl border flex items-center gap-3 transition-all ${
                    selected
                      ? 'bg-white dark:bg-[#12221C] border-emerald-600 shadow-md'
                      : 'bg-white/75 dark:bg-[#101D18]/75 border-[#E3ECE7] dark:border-emerald-950/70 hover:border-emerald-300'
                  }`}
                >
                  <span
                    className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-extrabold shrink-0 ${
                      selected
                        ? 'bg-emerald-600 text-white'
                        : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#132238] dark:text-white">{scr.label}</p>
                    <p className="text-xs text-[#52637A] dark:text-slate-400 truncate">{scr.sub}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Center Phone Frame */}
          <div className="lg:col-span-4 flex justify-center">
            <div className="w-[270px] rounded-[34px] bg-[#132238] p-3 shadow-2xl border border-slate-700/60">
              <div className="rounded-[26px] bg-white dark:bg-[#0F1E18] overflow-hidden">
                <div className="bg-gradient-to-br from-[#198754] to-[#14533C] px-4 py-4 text-white">
                  <p className="text-[10px] uppercase tracking-wider opacity-80">CuraBridge Patient</p>
                  <p className="font-display font-bold text-base">{current.title}</p>
                </div>
                <div className="p-4 space-y-2.5 text-xs">
                  {current.id === 'appointments' && (
                    <>
                      {[
                        { doc: 'Dr. Subhash Chandra', spec: 'Cardiology', ref: 'Confirmed • 10:00 IST' },
                        { doc: 'Dr. Priyanka Chatterjee', spec: 'Pediatrics', ref: 'Completed • Rx Ready' },
                      ].map((row) => (
                        <div key={row.doc} className="p-3 rounded-xl bg-[#F5FAF7] dark:bg-[#152A21] border border-[#E3ECE7] dark:border-emerald-900/60 space-y-1">
                          <p className="font-bold text-[#132238] dark:text-white">{row.doc}</p>
                          <p className="text-[11px] text-[#52637A] dark:text-slate-400">{row.spec}</p>
                          <span className="inline-block text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100/80 dark:bg-emerald-900/70 px-2 py-0.5 rounded-full">
                            {row.ref}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                  {current.id === 'vitals' && (
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { k: 'BP', v: '118/76' },
                        { k: 'Pulse', v: '72 bpm' },
                        { k: 'SpO2', v: '99%' },
                        { k: 'Glucose', v: '104 mg/dL' },
                      ].map((v) => (
                        <div key={v.k} className="p-3 rounded-xl bg-[#F5FAF7] dark:bg-[#152A21] border border-[#E3ECE7] dark:border-emerald-900/60">
                          <p className="text-[10px] text-[#52637A] dark:text-slate-400 font-semibold">{v.k}</p>
                          <p className="font-display font-extrabold text-sm text-[#132238] dark:text-white mt-0.5">{v.v}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {current.id === 'passport' && (
                    <div className="p-3 rounded-xl bg-[#F5FAF7] dark:bg-[#152A21] border border-[#E3ECE7] dark:border-emerald-900/60 space-y-2">
                      <p className="font-bold text-[#132238] dark:text-white">Latest Digital Rx #v2</p>
                      <p className="text-[11px] text-[#52637A] dark:text-slate-300">Amoxicillin 500mg • 1-0-1 (5d)</p>
                      <span className="inline-block text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-600 text-white">
                        Download Signed PDF
                      </span>
                    </div>
                  )}
                  {current.id === 'ems' && (
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 space-y-1.5">
                      <p className="font-bold text-rose-700 dark:text-rose-300">EMS Priority Active</p>
                      <p className="text-[11px] text-[#52637A] dark:text-slate-300">Nearest Trauma Center: 1.4 km away</p>
                      <p className="font-mono text-xs font-extrabold text-[#132238] dark:text-white">ETA: 06 min 15 sec</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right detail summary */}
          <div className="lg:col-span-4 space-y-4">
            <span className="font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
              {current.num}
            </span>
            <h3 className="font-display font-extrabold text-2xl text-[#132238] dark:text-white">
              {current.title}
            </h3>
            <p className="text-sm text-[#52637A] dark:text-slate-300 leading-relaxed">
              {current.desc}
            </p>
            <ul className="space-y-2">
              {current.checks.map((c) => (
                <li key={c} className="flex items-start gap-2 text-xs font-medium text-[#132238] dark:text-slate-200">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
            <div className="pt-2">
              <Link
                href="/doctors"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#132238] hover:bg-[#198754] dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white text-xs font-bold shadow-sm transition-colors"
              >
                <span>Open CuraBridge Portal</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function DualComparisonAndSteps() {
  return (
    <>
      {/* Dual Comparison Cards */}
      <section className="py-20 bg-white dark:bg-[#091310]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2.5">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
              SHARE &amp; UNDERSTAND
            </p>
            <h2 className="font-display font-extrabold text-3xl sm:text-4xl text-[#132238] dark:text-white tracking-tight">
              Show any doctor. <span className="text-emerald-600 dark:text-emerald-400">See what&apos;s changing.</span>
            </h2>
            <p className="text-sm sm:text-base text-[#52637A] dark:text-slate-300">
              Present your portable Health Passport during clinic visits and review bloodwork &amp; vitals trends cleanly side by side.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Card: Health Passport Summary */}
            <div className="cb-card rounded-3xl p-6 sm:p-8 space-y-6">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                <QrCode className="w-3 h-3" aria-hidden="true" />
                HEALTH PASSPORT
              </span>
              <div>
                <h3 className="font-display font-extrabold text-xl sm:text-2xl text-[#132238] dark:text-white">
                  Instant doctor-ready records
                </h3>
                <p className="text-xs sm:text-sm text-[#52637A] dark:text-slate-400 mt-1">
                  Structured allergies, medications, completed lab results, and digital prescriptions in one printable place.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center p-5 rounded-2xl bg-[#F6FAF8] dark:bg-[#0E1C17] border border-[#E3ECE7] dark:border-emerald-900/60">
                <div className="p-4 rounded-2xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/60 text-center space-y-2 shadow-sm">
                  <p className="text-[11px] font-bold text-[#132238] dark:text-white">My Health Passport</p>
                  <div className="w-24 h-24 mx-auto rounded-xl bg-[#F6FAF8] dark:bg-[#091310] flex items-center justify-center border border-[#E3ECE7] dark:border-emerald-900">
                    <QrCode className="w-16 h-16 text-[#132238] dark:text-emerald-300" aria-hidden="true" />
                  </div>
                  <p className="font-mono text-xs font-bold text-[#132238] dark:text-slate-200">CB-7K2-94Q</p>
                </div>
                <div className="space-y-3 text-xs">
                  {[
                    { n: '1', t: 'Always updated after consults', d: 'Prescriptions & lab orders land straight in your timeline.' },
                    { n: '2', t: 'Print or carry offline', d: 'Clean medical report layout for hospitals & clinics.' },
                    { n: '3', t: 'Role-protected access', d: 'Encrypted JWT + audit-logged reads keep records private.' },
                  ].map((step) => (
                    <div key={step.n} className="flex items-start gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                        {step.n}
                      </span>
                      <div>
                        <p className="font-bold text-[#132238] dark:text-white">{step.t}</p>
                        <p className="text-[11px] text-[#52637A] dark:text-slate-400">{step.d}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Card: Compare Reports */}
            <div className="cb-card rounded-3xl p-6 sm:p-8 space-y-6">
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                <Activity className="w-3 h-3" aria-hidden="true" />
                TRACK RESULTS
              </span>
              <div>
                <h3 className="font-display font-extrabold text-xl sm:text-2xl text-[#132238] dark:text-white">
                  See your progress, not just numbers
                </h3>
                <p className="text-xs sm:text-sm text-[#52637A] dark:text-slate-400 mt-1">
                  Compare vitals and diagnostic metrics across visits with instant trend indicators.
                </p>
              </div>
              <div className="rounded-2xl border border-[#E3ECE7] dark:border-emerald-900/60 overflow-hidden bg-[#FAFDFB] dark:bg-[#0E1C17]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F2F8F4] dark:bg-[#12221C] text-[#52637A] dark:text-slate-400 border-b border-[#E3ECE7] dark:border-emerald-900/60">
                    <tr>
                      <th className="py-2.5 px-4 font-semibold">Biomarker</th>
                      <th className="py-2.5 px-3 font-semibold">Jun</th>
                      <th className="py-2.5 px-3 font-semibold">Oct</th>
                      <th className="py-2.5 px-4 font-semibold">Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E3ECE7] dark:divide-emerald-950/80">
                    {[
                      { k: 'HbA1c (%)', v1: '7.6', v2: '6.4', badge: 'Better' },
                      { k: 'Fasting Glucose', v1: '138', v2: '104', badge: 'Normal' },
                      { k: 'Hemoglobin (g/dL)', v1: '11.4', v2: '12.9', badge: 'Better' },
                      { k: 'LDL Cholesterol', v1: '172', v2: '126', badge: 'Better' },
                    ].map((row) => (
                      <tr key={row.k}>
                        <td className="py-2.5 px-4 font-semibold text-[#132238] dark:text-slate-100">{row.k}</td>
                        <td className="py-2.5 px-3 text-rose-600 dark:text-rose-400 font-mono">{row.v1}</td>
                        <td className="py-2.5 px-3 text-[#132238] dark:text-white font-mono font-bold">{row.v2}</td>
                        <td className="py-2.5 px-4">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-300">
                            {row.badge}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-3.5 border-t border-[#E3ECE7] dark:border-emerald-900/60 flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-[#132238] dark:text-slate-200">
                    HbA1c trend: 7.6 → 6.4%
                  </span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">Back in target range</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Four Simple Steps */}
      <section className="py-16 bg-[#F6FAF8] dark:bg-[#0D1A15] border-y border-[#E3ECE7] dark:border-emerald-950/80">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
              HOW IT WORKS
            </p>
            <h2 className="font-display font-extrabold text-3xl text-[#132238] dark:text-white">
              Care in <span className="text-emerald-600 dark:text-emerald-400">four simple steps</span>
            </h2>
            <p className="text-sm text-[#52637A] dark:text-slate-300">
              From finding the right doctor to receiving your digital prescription — everything happens seamlessly.
            </p>
          </div>

          <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <div
              className="hidden lg:block absolute top-7 left-[12%] right-[12%] h-[2px] bg-emerald-200 dark:bg-emerald-900"
              aria-hidden="true"
            />
            {[
              { step: 'STEP 01', icon: UserPlus, title: 'Create your account', body: 'Register securely as a patient or physician in under 30 seconds.' },
              { step: 'STEP 02', icon: Search, title: 'Find the right care', body: 'Search verified specialists by symptom, specialty, rating, or fee.' },
              { step: 'STEP 03', icon: CalendarCheck, title: 'Lock slot & checkout', body: '10-minute exclusive slot hold prevents collisions while you pay.' },
              { step: 'STEP 04', icon: FileCheck2, title: 'Consult & stay on track', body: 'Join LiveKit HD video or clinic, and save every Rx in your Passport.' },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="relative text-center space-y-3">
                  <div className="w-14 h-14 mx-auto rounded-full bg-[#198754] text-white flex items-center justify-center shadow-md ring-4 ring-[#F6FAF8] dark:ring-[#0D1A15]">
                    <Icon className="w-6 h-6" aria-hidden="true" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
                    {item.step}
                  </p>
                  <h3 className="font-display font-bold text-base text-[#132238] dark:text-white">
                    {item.title}
                  </h3>
                  <p className="text-xs text-[#52637A] dark:text-slate-400 leading-relaxed max-w-[230px] mx-auto">
                    {item.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}

export function BuiltAroundTimeAndDirectory() {
  const { data: liveDoctors = [] } = useQuery<LiveDoctorCard[]>({
    queryKey: ['landing-verified-doctors'],
    queryFn: async () => {
      const res = await fetchApi<{ data?: LiveDoctorCard[] }>('/doctors?limit=6');
      return Array.isArray(res?.data) ? res.data : [];
    },
  });

  return (
    <>
      {/* Bento Grid: Built Around Your Time */}
      <section className="py-20 bg-white dark:bg-[#091310]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
              WHY CURABRIDGE
            </p>
            <h2 className="font-display font-extrabold text-3xl sm:text-4xl text-[#132238] dark:text-white tracking-tight">
              Built around <span className="text-emerald-600 dark:text-emerald-400">your time</span>
            </h2>
            <p className="text-sm text-[#52637A] dark:text-slate-300">
              Real specialist schedules, deterministic booking locks, and clinical records that move with you.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 space-y-6">
              <div className="cb-card rounded-3xl p-6 space-y-4">
                <span className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                  <Activity className="w-5 h-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-display font-bold text-lg text-[#132238] dark:text-white">
                    Know availability before you travel
                  </h3>
                  <p className="text-xs text-[#52637A] dark:text-slate-400 mt-1">
                    Verified doctor rosters update in real time — pick video or clinic slots with zero guesswork.
                  </p>
                </div>
                <div className="space-y-2 pt-1">
                  {[
                    { name: 'Dr. Subhash Chandra', spec: 'Cardiology', status: 'Available today' },
                    { name: 'Dr. Priyanka Chatterjee', spec: 'Pediatrics', status: 'Available today' },
                    { name: 'Dr. Ananya Sen', spec: 'General Medicine', status: 'Video & Clinic' },
                  ].map((d) => (
                    <div
                      key={d.name}
                      className="px-3.5 py-2.5 rounded-xl bg-[#F6FAF8] dark:bg-[#0E1C17] border border-[#E3ECE7] dark:border-emerald-900/50 flex items-center justify-between text-xs"
                    >
                      <div>
                        <p className="font-bold text-[#132238] dark:text-white">{d.name}</p>
                        <p className="text-[11px] text-[#52637A] dark:text-slate-400">{d.spec}</p>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/70 dark:text-emerald-300">
                        {d.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="cb-card rounded-3xl p-6 space-y-2.5">
                  <span className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                    <Clock className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <h4 className="font-display font-bold text-base text-[#132238] dark:text-white">
                    Zero double-booking
                  </h4>
                  <p className="text-xs text-[#52637A] dark:text-slate-400 leading-relaxed">
                    Redis slot locks &amp; Postgres partial unique indexes guarantee your time slot is yours alone.
                  </p>
                </div>
                <div className="cb-card rounded-3xl p-6 space-y-2.5">
                  <span className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                    <Lock className="w-4 h-4" aria-hidden="true" />
                  </span>
                  <h4 className="font-display font-bold text-base text-[#132238] dark:text-white">
                    Private by design
                  </h4>
                  <p className="text-xs text-[#52637A] dark:text-slate-400 leading-relaxed">
                    HttpOnly token rotation, role guards, and audit logs protect every patient consultation record.
                  </p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="cb-card rounded-3xl p-6 sm:p-8 h-full flex flex-col justify-between space-y-6">
                <div className="space-y-2">
                  <span className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                    <FileCheck2 className="w-5 h-5" aria-hidden="true" />
                  </span>
                  <h3 className="font-display font-bold text-xl text-[#132238] dark:text-white">
                    Your health, in one place
                  </h3>
                  <p className="text-xs sm:text-sm text-[#52637A] dark:text-slate-400">
                    Access your longitudinal Health Passport, digital Rx PDFs, and emergency dispatch whenever needed.
                  </p>
                </div>

                <div className="p-5 rounded-2xl bg-[#F6FAF8] dark:bg-[#0E1C17] border border-[#E3ECE7] dark:border-emerald-900/60 space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/80 text-emerald-800 dark:text-emerald-200 font-bold text-xs flex items-center justify-center">
                      AR
                    </span>
                    <div>
                      <p className="text-sm font-bold text-[#132238] dark:text-white">Anita Roy</p>
                      <p className="text-[11px] font-mono text-[#52637A] dark:text-slate-400">Passport ID · CB-2048</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2.5 text-center">
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200/60 dark:border-rose-900/60">
                      <p className="font-display font-extrabold text-base text-rose-700 dark:text-rose-300">O+</p>
                      <p className="text-[10px] text-[#52637A] dark:text-slate-400">Blood</p>
                    </div>
                    <div className="p-3 rounded-xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/60">
                      <p className="font-display font-extrabold text-base text-[#132238] dark:text-white">99%</p>
                      <p className="text-[10px] text-[#52637A] dark:text-slate-400">SpO2</p>
                    </div>
                    <div className="p-3 rounded-xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/60">
                      <p className="font-display font-extrabold text-base text-[#132238] dark:text-white">72</p>
                      <p className="text-[10px] text-[#52637A] dark:text-slate-400">BPM</p>
                    </div>
                  </div>
                  <Link
                    href="/emergency"
                    className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-900/70 hover:border-emerald-500 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <QrCode className="w-5 h-5 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                      <div>
                        <p className="text-xs font-bold text-[#132238] dark:text-white">Emergency Dispatch &amp; Passport</p>
                        <p className="text-[11px] text-[#52637A] dark:text-slate-400">Live trauma centers &amp; EMS tracking</p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Explore Verified Specialists Live Directory Preview */}
      {liveDoctors.length > 0 && (
        <section className="py-16 bg-[#F6FAF8] dark:bg-[#0D1A15] border-t border-[#E3ECE7] dark:border-emerald-950/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h2 className="font-display font-extrabold text-2xl sm:text-3xl text-[#132238] dark:text-white">
                  Explore verified specialists
                </h2>
                <p className="text-xs sm:text-sm text-[#52637A] dark:text-slate-400 mt-1">
                  Board-certified clinics with instant availability and direct slot booking.
                </p>
              </div>
              <Link
                href="/doctors"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#DCEAE2] dark:border-emerald-800 bg-white dark:bg-[#12221C] text-xs font-bold text-[#132238] dark:text-white hover:border-emerald-500 transition-colors shrink-0"
              >
                <span>View all specialists</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {liveDoctors.slice(0, 6).map((doc) => (
                <Link
                  key={doc.id}
                  href={`/doctors/${doc.id}`}
                  className="cb-card group p-4 rounded-2xl flex items-center justify-between gap-3 hover:border-emerald-500 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                      <Stethoscope className="w-5 h-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-[#132238] dark:text-white truncate group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">
                        {doc.name}
                      </p>
                      <p className="text-[11px] text-[#52637A] dark:text-slate-400 truncate flex items-center gap-1">
                        <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>{doc.specialty}{doc.clinicName ? ` · ${doc.clinicName}` : ''}</span>
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#52637A] group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all shrink-0" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Trusted Reviews */}
      <section className="py-16 bg-white dark:bg-[#091310] border-t border-[#E3ECE7] dark:border-emerald-950/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          <div className="text-center space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
              LOVED BY CARE TEAMS
            </p>
            <h2 className="font-display font-extrabold text-3xl text-[#132238] dark:text-white">
              Trusted by <span className="text-emerald-600 dark:text-emerald-400">clinics &amp; patients</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                quote: '“CuraBridge keeps our outpatient queue predictable and puts prescriptions plus lab orders in one clean workflow.”',
                author: 'Kolkata Heart & Care Clinic',
                initials: 'KH',
              },
              {
                quote: '“Booking a cardiologist took less than 60 seconds, with live slot locking and instant invoice confirmation.”',
                author: 'Anita Roy • Patient',
                initials: 'AR',
              },
              {
                quote: '“The LiveKit video consult room, vitals panel, and AI SOAP draft save precious minutes on every follow-up visit.”',
                author: 'Dr. Subhash Chandra • Cardiology',
                initials: 'SC',
              },
            ].map((item) => (
              <div key={item.author} className="cb-card rounded-2xl p-6 flex flex-col justify-between space-y-5">
                <div className="space-y-3">
                  <div className="flex items-center gap-1 text-amber-500 text-xs font-bold">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star key={i} className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                    ))}
                    <span className="ml-1 text-[#132238] dark:text-white">5/5</span>
                  </div>
                  <p className="text-xs sm:text-sm text-[#52637A] dark:text-slate-300 leading-relaxed">
                    {item.quote}
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="w-9 h-9 rounded-full bg-emerald-700 text-white text-xs font-bold flex items-center justify-center shrink-0">
                    {item.initials}
                  </span>
                  <span className="text-xs font-bold text-[#132238] dark:text-white">{item.author}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Portal Access Cards + Green Ready Banner */}
      <section className="py-16 bg-[#F6FAF8] dark:bg-[#0D1A15] border-t border-[#E3ECE7] dark:border-emerald-950/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
          <div className="space-y-10">
            <div className="text-center space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-400">
                FOR CARE TEAMS &amp; PATIENTS
              </p>
              <h2 className="font-display font-extrabold text-3xl text-[#132238] dark:text-white">
                Manage your care on <span className="text-emerald-600 dark:text-emerald-400">CuraBridge</span>
              </h2>
              <p className="text-sm text-[#52637A] dark:text-slate-300">
                Role-tailored workspaces for patients, physicians, ambulance crews, and compliance admins.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {[
                {
                  tag: 'For patients',
                  title: 'Patients',
                  icon: Users,
                  items: ['Verified specialist booking', 'Digital Rx & Health Passport', 'Policy-backed refunds'],
                  primaryHref: '/doctors',
                  primaryLabel: 'Browse Doctors',
                  secondaryHref: '/auth/login',
                  secondaryLabel: 'Sign In / Register',
                },
                {
                  tag: 'For doctors',
                  title: 'Physicians',
                  icon: Stethoscope,
                  items: ['Live queue & weekly roster', 'Leave impact dry-run & auto-refunds', 'HD video & AI SOAP notes'],
                  primaryHref: '/doctor/dashboard',
                  primaryLabel: 'Doctor Portal',
                  secondaryHref: '/auth/login',
                  secondaryLabel: 'Register Clinic',
                },
                {
                  tag: 'For EMS',
                  title: 'Ambulance Crew',
                  icon: Ambulance,
                  items: ['Priority dispatch offers', 'Live GPS coordinate stream', 'Trauma center coordination'],
                  primaryHref: '/emergency',
                  primaryLabel: 'Emergency Console',
                  secondaryHref: '/auth/login',
                  secondaryLabel: 'Driver Sign In',
                },
                {
                  tag: 'For compliance',
                  title: 'Clinical Admin',
                  icon: ShieldCheck,
                  items: ['Doctor NMC verification queue', 'Double-entry payment ledger', 'Immutable security audit trail'],
                  primaryHref: '/admin',
                  primaryLabel: 'Admin Portal',
                  secondaryHref: '/auth/login',
                  secondaryLabel: 'Admin Sign In',
                },
              ].map((card) => {
                const Icon = card.icon;
                return (
                  <div key={card.title} className="cb-card rounded-3xl p-6 flex flex-col justify-between space-y-5">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="w-10 h-10 rounded-xl bg-[#198754] text-white flex items-center justify-center">
                          <Icon className="w-5 h-5" aria-hidden="true" />
                        </span>
                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                          {card.tag}
                        </span>
                      </div>
                      <h3 className="font-display font-bold text-lg text-[#132238] dark:text-white">
                        {card.title}
                      </h3>
                      <ul className="space-y-1.5 text-xs text-[#52637A] dark:text-slate-300">
                        {card.items.map((pt) => (
                          <li key={pt} className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="space-y-2 pt-2">
                      <Link
                        href={card.primaryHref}
                        className="block w-full py-2.5 text-center rounded-full bg-[#198754] hover:bg-[#146C43] text-white text-xs font-bold transition-colors"
                      >
                        {card.primaryLabel}
                      </Link>
                      <Link
                        href={card.secondaryHref}
                        className="block w-full py-2 text-center rounded-full border border-[#DCEAE2] dark:border-emerald-900 text-[#132238] dark:text-slate-200 hover:border-emerald-500 text-xs font-semibold transition-colors"
                      >
                        {card.secondaryLabel}
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Ready Banner */}
          <div className="rounded-3xl bg-gradient-to-r from-[#22A06B] to-[#198754] p-8 sm:p-12 text-white flex flex-col md:flex-row items-center justify-between gap-8 shadow-lg">
            <div className="space-y-3 text-center md:text-left">
              <h2 className="font-display font-extrabold text-3xl sm:text-4xl tracking-tight">
                Ready when you are.
              </h2>
              <p className="text-sm sm:text-base text-emerald-50 max-w-xl">
                Book verified specialists in seconds, keep every prescription &amp; lab order organized, and access 24/7 EMS whenever you need it.
              </p>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 pt-2">
                <Link
                  href="/auth/login"
                  className="px-6 py-3 rounded-full bg-white text-[#14533C] hover:bg-emerald-50 font-bold text-xs sm:text-sm shadow-sm inline-flex items-center gap-1.5 transition-colors"
                >
                  <span>Create free account</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/doctors"
                  className="px-6 py-3 rounded-full border border-white/40 hover:bg-white/10 text-white font-bold text-xs sm:text-sm transition-colors"
                >
                  Browse Specialists
                </Link>
              </div>
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-[11px] text-emerald-50/90 pt-1">
                <span>Data protected</span>
                <span>•</span>
                <span>10-min slot holds</span>
                <span>•</span>
                <span>24/7 Emergency SOS</span>
              </div>
            </div>

            <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-3xl bg-white/15 border border-white/25 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-16 h-16 text-white" aria-hidden="true" />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
