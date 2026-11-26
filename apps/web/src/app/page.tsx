'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import {
  Search,
  PhoneCall,
  Award,
  ChevronRight,
  Heart,
  Brain,
  Baby,
  Bone,
  Stethoscope,
  Sparkles,
  ShieldCheck,
  Clock,
  Activity,
} from 'lucide-react';

const MedicalHelixCanvas = dynamic(
  () => import('@/components/three/medical-helix-canvas').then((m) => m.MedicalHelixCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[340px] sm:h-[420px] rounded-3xl bg-slate-900/90 border border-teal-500/20 animate-pulse" />
    ),
  },
);

export default function HomePage() {
  const { t } = useI18n();
  const router = useRouter();
  const [symptomQuery, setSymptomQuery] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (symptomQuery.trim()) {
      router.push(`/doctors?q=${encodeURIComponent(symptomQuery.trim())}`);
    } else {
      router.push('/doctors');
    }
  };

  const specialties = [
    {
      name: 'General Physician',
      icon: Stethoscope,
      count: '320+ Doctors',
      desc: 'Fever, cold, viral infections, lifestyle health',
    },
    {
      name: 'Cardiology',
      icon: Heart,
      count: '94 Doctors',
      desc: 'Blood pressure, chest discomfort, heart health',
    },
    {
      name: 'Dermatology',
      icon: Sparkles,
      count: '142 Doctors',
      desc: 'Acne, skin allergy, eczema, hair loss',
    },
    {
      name: 'Neurology',
      icon: Brain,
      count: '65 Doctors',
      desc: 'Migraine, nerve disorders, chronic headache',
    },
    {
      name: 'Pediatrics',
      icon: Baby,
      count: '110 Doctors',
      desc: 'Child vaccination, infant fever, nutrition',
    },
    {
      name: 'Orthopedics',
      icon: Bone,
      count: '88 Doctors',
      desc: 'Joint pain, fractures, spine & sports injury',
    },
  ];

  return (
    <div className="space-y-20 pb-16">
      {/* Emergency Banner */}
      <div className="bg-rose-600 text-white py-2.5 px-4 text-xs font-semibold shadow-inner">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-200 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
            </span>
            <span>Experiencing severe chest pain, shortness of breath, or trauma?</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="tel:112" className="underline hover:text-rose-100 flex items-center gap-1">
              <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" /> Call National Emergency 112
            </a>
            <span aria-hidden="true">|</span>
            <Link
              href="/emergency"
              className="bg-white text-rose-700 px-3 py-1 rounded-lg font-bold hover:bg-rose-50 transition-colors"
            >
              Dispatch Ambulance
            </Link>
          </div>
        </div>
      </div>

      {/* Asymmetric 3D Bento Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          {/* Left Column: Typography + Search + Trust */}
          <div className="lg:col-span-7 space-y-6 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-xs font-semibold">
              <Award className="w-4 h-4" aria-hidden="true" />
              <span>{t.hero.badge}</span>
            </div>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.1]">
              Instant Healthcare,{' '}
              <span className="bg-gradient-to-r from-teal-600 to-cyan-500 bg-clip-text text-transparent">
                Trusted Doctors
              </span>{' '}
              &amp; Ambulance Dispatch
            </h1>

            <p className="text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
              {t.hero.subtitle}
            </p>

            {/* Symptom Search Bar */}
            <form onSubmit={handleSearch} className="max-w-2xl mx-auto lg:mx-0">
              <label htmlFor="hero-symptom-search" className="visually-hidden">
                Search doctors, specialties, or symptoms
              </label>
              <div className="relative flex items-center p-2 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-xl border border-slate-200 dark:border-slate-800 focus-within:ring-2 focus-within:ring-teal-500">
                <Search className="w-5 h-5 text-slate-400 ml-3 shrink-0" aria-hidden="true" />
                <input
                  id="hero-symptom-search"
                  type="text"
                  value={symptomQuery}
                  onChange={(e) => setSymptomQuery(e.target.value)}
                  placeholder={t.hero.searchPlaceholder}
                  className="w-full bg-transparent border-none px-4 py-2.5 text-sm sm:text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
                />
                <button
                  type="submit"
                  className="shrink-0 px-5 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm shadow-md transition-colors"
                >
                  {t.hero.searchButton}
                </button>
              </div>
            </form>

            {/* Quick Symptoms Pills */}
            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Popular symptoms:</span>
              {['Fever', 'Skin Rash', 'Persistent Cough', 'Migraine', 'Joint Pain'].map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => router.push(`/doctors?q=${encodeURIComponent(sym)}`)}
                  className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 hover:bg-teal-50 hover:text-teal-700 dark:hover:bg-teal-950/80 transition-colors"
                >
                  {sym}
                </button>
              ))}
            </div>

            {/* Trust Micro-Badges */}
            <div className="pt-2 flex flex-wrap items-center justify-center lg:justify-start gap-5 text-xs text-slate-600 dark:text-slate-400 font-medium">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-teal-600" aria-hidden="true" />
                Redis Atomic Hold Locks
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-cyan-600" aria-hidden="true" />
                Live Vitals &amp; Diagnostic Labs
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-rose-600" aria-hidden="true" />
                &lt; 8 Min EMS Dispatch
              </span>
            </div>
          </div>

          {/* Right Column: Interactive Three.js 3D Bio-Helix */}
          <div className="lg:col-span-5">
            <MedicalHelixCanvas />
          </div>
        </div>

        {/* Stats Row */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6 pt-8 border-t border-slate-200 dark:border-slate-800">
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 shadow-sm">
            <p className="text-2xl font-bold text-teal-600 dark:text-teal-400 tabular-nums">
              {t.hero.statPatients}
            </p>
            <p className="text-xs text-slate-500 mt-1 font-medium">Completed with 4.9★ rating</p>
          </div>
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 shadow-sm">
            <p className="text-2xl font-bold text-teal-600 dark:text-teal-400 tabular-nums">
              {t.hero.statDoctors}
            </p>
            <p className="text-xs text-slate-500 mt-1 font-medium">NMC Board-Verified Specialists</p>
          </div>
          <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 shadow-sm">
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 tabular-nums">
              {t.hero.statResponse}
            </p>
            <p className="text-xs text-slate-500 mt-1 font-medium">Live GPS Ambulance Dispatch</p>
          </div>
        </div>
      </section>

      {/* Specialties Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Top Clinical Specialties</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Select a specialty for instant video or in-clinic consultation
            </p>
          </div>
          <Link
            href="/doctors"
            className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline flex items-center gap-1"
          >
            View all specialties <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {specialties.map((spec) => {
            const Icon = spec.icon;
            return (
              <Link
                key={spec.name}
                href={`/doctors?specialty=${encodeURIComponent(spec.name)}`}
                className="group p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-teal-500/60 hover:shadow-xl transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="w-12 h-12 rounded-xl bg-teal-50 dark:bg-teal-950 text-teal-600 dark:text-teal-400 flex items-center justify-center group-hover:bg-teal-600 group-hover:text-white transition-colors">
                    <Icon className="w-6 h-6" aria-hidden="true" />
                  </div>
                  <span className="text-xs font-semibold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/60 px-2.5 py-1 rounded-md">
                    {spec.count}
                  </span>
                </div>
                <h3 className="mt-4 font-bold text-base text-slate-900 dark:text-white group-hover:text-teal-600 transition-colors">
                  {spec.name}
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {spec.desc}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 bg-gradient-to-b from-teal-50/60 to-transparent dark:from-teal-950/25 rounded-3xl border border-teal-100 dark:border-teal-900/40">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">How MediBook Telehealth Operates</h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Zero double-booking guarantee with real-time hold locks and compliant video care
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg mx-auto shadow-md">
              1
            </div>
            <h3 className="font-semibold text-sm text-slate-900 dark:text-white mt-4">Search &amp; Match</h3>
            <p className="text-xs text-slate-500 mt-1">AI-assisted symptom search matching verified board doctors.</p>
          </div>
          <div className="text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg mx-auto shadow-md">
              2
            </div>
            <h3 className="font-semibold text-sm text-slate-900 dark:text-white mt-4">10-Min Hold Lease</h3>
            <p className="text-xs text-slate-500 mt-1">Redis lease reserves your slot exclusively with zero double-booking.</p>
          </div>
          <div className="text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg mx-auto shadow-md">
              3
            </div>
            <h3 className="font-semibold text-sm text-slate-900 dark:text-white mt-4">HD Video &amp; Vitals</h3>
            <p className="text-xs text-slate-500 mt-1">Encrypted LiveKit consultation with real-time vitals telemetry.</p>
          </div>
          <div className="text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg mx-auto shadow-md">
              4
            </div>
            <h3 className="font-semibold text-sm text-slate-900 dark:text-white mt-4">Rx &amp; Lab Orders</h3>
            <p className="text-xs text-slate-500 mt-1">Doctor issues immutable digital Rx and diagnostic lab orders.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
