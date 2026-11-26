'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { gsap, useGSAP, isReducedMotion } from '@/lib/gsap';
import { AnimatedCounter } from '@/components/gsap/animated-counter';
import { GsapCard } from '@/components/gsap/gsap-card';
import { GsapReveal } from '@/components/gsap/gsap-reveal';
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
  ArrowUpRight,
  Ambulance,
  Video,
  FileCheck2,
} from 'lucide-react';

const MedicalHelixCanvas = dynamic(
  () => import('@/components/three/medical-helix-canvas').then((m) => m.MedicalHelixCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[380px] sm:h-[440px] rounded-3xl bg-[#071521] border border-teal-500/20 animate-pulse" />
    ),
  },
);

export default function HomePage() {
  const { t } = useI18n();
  const router = useRouter();
  const [symptomQuery, setSymptomQuery] = useState('');

  const pageRef = useRef<HTMLDivElement>(null);
  const heroLeftRef = useRef<HTMLDivElement>(null);

  // Subtle GPU-composited entrance using fromTo so content is never left invisible
  useGSAP(
    () => {
      if (isReducedMotion() || !heroLeftRef.current) return;
      const items = heroLeftRef.current.querySelectorAll('.hero-stagger');
      if (items.length > 0) {
        gsap.fromTo(
          items,
          { y: 14, opacity: 0.94 },
          {
            y: 0,
            opacity: 1,
            duration: 0.55,
            stagger: 0.06,
            ease: 'power2.out',
            clearProps: 'transform,opacity',
          },
        );
      }
    },
    { scope: pageRef },
  );

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
      name: 'General Medicine',
      icon: Stethoscope,
      count: '320+ Doctors',
      desc: 'Fever, respiratory infection, diabetes, primary care',
    },
    {
      name: 'Cardiology',
      icon: Heart,
      count: '94 Doctors',
      desc: 'Hypertension, chest evaluation, preventive cardiac care',
    },
    {
      name: 'Dermatology',
      icon: Sparkles,
      count: '142 Doctors',
      desc: 'Acne, skin allergy, eczema, dermatological consults',
    },
    {
      name: 'Neurology',
      icon: Brain,
      count: '65 Doctors',
      desc: 'Migraine, vertigo, nerve disorders, chronic headache',
    },
    {
      name: 'Pediatrics',
      icon: Baby,
      count: '110 Doctors',
      desc: 'Child vaccination, pediatric fever, growth nutrition',
    },
    {
      name: 'Orthopedics',
      icon: Bone,
      count: '88 Doctors',
      desc: 'Joint pain, ligament injury, spine & sports orthopedics',
    },
  ];

  const workflowSteps = [
    {
      step: '01',
      title: 'Symptom Search & Match',
      desc: 'AI triage and pg_trgm search pair your symptoms with NMC-verified specialists.',
      icon: Search,
    },
    {
      step: '02',
      title: '10-Min Redis Hold Lock',
      desc: 'Exclusive atomic slot lease guarantees zero double-booking during checkout.',
      icon: ShieldCheck,
    },
    {
      step: '03',
      title: 'Encrypted LiveKit Care',
      desc: 'Join HD video consultations with real-time vitals telemetry and clinical chat.',
      icon: Video,
    },
    {
      step: '04',
      title: 'Digital Rx & Lab Orders',
      desc: 'Receive versioned digital prescriptions and lab orders straight to your Health Passport.',
      icon: FileCheck2,
    },
  ];

  return (
    <div ref={pageRef} className="pb-16">
      {/* Ambient Editorial Hero Section */}
      <section className="relative bg-clinical-grid border-b border-slate-200/70 dark:border-slate-800/70 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-10 pb-14 sm:pb-20 space-y-12">
          {/* Calm Clinical Emergency Utility Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-white/90 dark:bg-slate-900/80 backdrop-blur-md border border-rose-200/80 dark:border-rose-900/50 shadow-sm text-xs">
            <div className="flex items-center gap-2.5 text-slate-700 dark:text-slate-200 font-medium">
              <span className="flex h-2.5 w-2.5 relative shrink-0" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600" />
              </span>
              <span>{t.hero.emergencyCta}</span>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="tel:112"
                className="inline-flex items-center gap-1.5 font-semibold text-rose-700 dark:text-rose-400 hover:underline"
              >
                <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Dial 112</span>
              </a>
              <Link
                href="/emergency"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-bold shadow-sm transition-colors"
              >
                <Ambulance className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Dispatch Ambulance</span>
              </Link>
            </div>
          </div>

          {/* Main Asymmetric Bento Hero */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* Left Column: Editorial Typography + Command Search */}
            <div ref={heroLeftRef} className="lg:col-span-7 space-y-6 text-center lg:text-left">
              <div className="hero-stagger inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-50 dark:bg-teal-950/70 border border-teal-200/80 dark:border-teal-800/70 text-teal-800 dark:text-teal-300 text-xs font-semibold shadow-sm">
                <Award className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                <span>{t.hero.badge}</span>
              </div>

              <h1
                className="hero-stagger font-display font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.08]"
                style={{ fontSize: 'clamp(2.2rem, 1.45rem + 2.6vw, 3.65rem)' }}
              >
                Precision Telehealth,{' '}
                <span className="bg-gradient-to-r from-teal-600 via-emerald-500 to-cyan-500 bg-clip-text text-transparent">
                  Verified Specialists
                </span>{' '}
                &amp; Instant EMS
              </h1>

              <p className="hero-stagger text-base sm:text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
                {t.hero.subtitle}
              </p>

              {/* Elevated Command Search Bar */}
              <form
                onSubmit={handleSearch}
                className="hero-stagger max-w-2xl mx-auto lg:mx-0"
              >
                <label htmlFor="hero-symptom-search" className="visually-hidden">
                  Search doctors, specialties, or symptoms
                </label>
                <div className="relative flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2 rounded-2xl bg-white dark:bg-slate-900/95 shadow-[0_12px_36px_-10px_rgba(15,23,42,0.12)] dark:shadow-[0_12px_36px_-10px_rgba(0,0,0,0.6)] border border-slate-200/90 dark:border-slate-700/80 focus-within:ring-2 focus-within:ring-teal-500 focus-within:border-teal-500 transition-all">
                  <div className="flex items-center flex-1">
                    <Search className="w-5 h-5 text-slate-400 ml-3 shrink-0" aria-hidden="true" />
                    <input
                      id="hero-symptom-search"
                      type="text"
                      value={symptomQuery}
                      onChange={(e) => setSymptomQuery(e.target.value)}
                      placeholder={t.hero.searchPlaceholder}
                      className="w-full bg-transparent border-none px-3.5 py-2.5 text-sm sm:text-base text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="shrink-0 px-6 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm shadow-sm transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>{t.hero.searchButton}</span>
                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </form>

              {/* Quick Symptoms Chips */}
              <div className="hero-stagger flex flex-wrap items-center justify-center lg:justify-start gap-2 text-xs">
                <span className="font-semibold text-slate-500 dark:text-slate-400">Common queries:</span>
                {['Fever', 'Skin Rash', 'Chest Pain', 'Migraine', 'Joint Pain'].map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => router.push(`/doctors?q=${encodeURIComponent(sym)}`)}
                    className="px-3 py-1.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-medium hover:border-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors shadow-sm"
                  >
                    {sym}
                  </button>
                ))}
              </div>

              {/* Trust Micro-Badges */}
              <div className="hero-stagger pt-2 flex flex-wrap items-center justify-center lg:justify-start gap-x-6 gap-y-2 text-xs text-slate-600 dark:text-slate-400 font-medium">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                  NMC Verified Physicians
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
                  ABDM Longitudinal Passport
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                  &lt; 8 Min Regional Dispatch
                </span>
              </div>
            </div>

            {/* Right Column: Integrated 3D Bio-Helix Telemetry Card */}
            <div className="lg:col-span-5">
              <MedicalHelixCanvas />
            </div>
          </div>

          {/* Bento Metrics Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 pt-4">
            <div className="clinical-card p-6 rounded-2xl bg-white/95 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                  <AnimatedCounter value={50000} suffix="+" />
                </p>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 font-medium">
                  Patient Consultations • 4.9★ Avg
                </p>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
                <Video className="w-5 h-5" aria-hidden="true" />
              </div>
            </div>

            <div className="clinical-card p-6 rounded-2xl bg-white/95 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                  <AnimatedCounter value={1200} suffix="+" />
                </p>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 font-medium">
                  Board-Certified Specialists
                </p>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
                <Stethoscope className="w-5 h-5" aria-hidden="true" />
              </div>
            </div>

            <div className="clinical-card p-6 rounded-2xl bg-white/95 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-between">
              <div>
                <p className="font-display text-2xl sm:text-3xl font-extrabold text-rose-600 dark:text-rose-400 tabular-nums">
                  <AnimatedCounter value={8} prefix="< " suffix=" Min" />
                </p>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 font-medium">
                  Live GPS Ambulance Arrival
                </p>
              </div>
              <div className="w-11 h-11 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <Ambulance className="w-5 h-5" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Clinical Specialties Directory */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16">
        <GsapReveal direction="up" className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
              Clinical Departments
            </span>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mt-1">
              Top Clinical Specialties
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Select a department for instant HD video, live chat, or in-clinic appointments
            </p>
          </div>
          <Link
            href="/doctors"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 dark:text-teal-400 hover:underline shrink-0"
          >
            <span>Browse all specialists</span>
            <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </GsapReveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {specialties.map((spec) => {
            const Icon = spec.icon;
            return (
              <GsapCard key={spec.name} tiltMax={5} scaleHover={1.015}>
                <Link
                  href={`/doctors?specialty=${encodeURIComponent(spec.name)}`}
                  className="clinical-card group block p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-teal-500/60 hover:shadow-lg transition-all h-full"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-teal-50 dark:bg-teal-950/70 text-teal-600 dark:text-teal-400 flex items-center justify-center group-hover:bg-teal-600 group-hover:text-white transition-colors">
                      <Icon className="w-6 h-6" aria-hidden="true" />
                    </div>
                    <span className="text-xs font-semibold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 px-2.5 py-1 rounded-full border border-teal-200/50 dark:border-teal-800/50">
                      {spec.count}
                    </span>
                  </div>
                  <div className="mt-5 flex items-center justify-between">
                    <h3 className="font-display font-bold text-lg text-slate-900 dark:text-white group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                      {spec.name}
                    </h3>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-teal-600 group-hover:translate-x-0.5 transition-all" aria-hidden="true" />
                  </div>
                  <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    {spec.desc}
                  </p>
                </Link>
              </GsapCard>
            );
          })}
        </div>
      </section>

      {/* Architectural Telehealth Workflow */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20">
        <div className="p-8 sm:p-12 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
          <GsapReveal direction="up" className="text-center max-w-2xl mx-auto mb-12">
            <span className="text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
              End-to-End Care Protocol
            </span>
            <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mt-1">
              How MediBook Telehealth Operates
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Deterministic scheduling, encrypted clinical video, and immutable patient health records
            </p>
          </GsapReveal>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative">
            {workflowSteps.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="relative space-y-3 text-center md:text-left">
                  <div className="flex items-center justify-center md:justify-start gap-3">
                    <div className="w-11 h-11 rounded-2xl bg-teal-600 text-white flex items-center justify-center shadow-md shadow-teal-600/20">
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <span className="font-mono text-xs font-bold text-teal-600 dark:text-teal-400">
                      STEP {item.step}
                    </span>
                  </div>
                  <h3 className="font-display font-bold text-base text-slate-900 dark:text-white">
                    {item.title}
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
