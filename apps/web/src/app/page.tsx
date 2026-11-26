'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { gsap, useGSAP, isReducedMotion } from '@/lib/gsap';
import { AnimatedCounter } from '@/components/gsap/animated-counter';
import { GsapCard } from '@/components/gsap/gsap-card';
import { FloatingElement } from '@/components/gsap/floating-element';
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
  Zap,
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

  const heroRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const subtitleRef = useRef<HTMLParagraphElement>(null);
  const searchBarRef = useRef<HTMLFormElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const trustRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const specialtiesRef = useRef<HTMLDivElement>(null);
  const howItWorksRef = useRef<HTMLDivElement>(null);

  // GSAP Entrance Animations
  useGSAP(
    () => {
      if (isReducedMotion()) return;

      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      // 1. Badge pop-in
      if (badgeRef.current) {
        tl.from(badgeRef.current, {
          y: -24,
          opacity: 0,
          scale: 0.9,
          duration: 0.6,
          ease: 'back.out(2)',
        });
      }

      // 2. Headline & Subtitle fade-up
      if (titleRef.current) {
        tl.from(
          titleRef.current,
          {
            y: 36,
            opacity: 0,
            duration: 0.85,
          },
          '-=0.3'
        );
      }

      if (subtitleRef.current) {
        tl.from(
          subtitleRef.current,
          {
            y: 20,
            opacity: 0,
            duration: 0.7,
          },
          '-=0.5'
        );
      }

      // 3. Search Bar emerge with subtle scale
      if (searchBarRef.current) {
        tl.from(
          searchBarRef.current,
          {
            y: 24,
            scale: 0.96,
            opacity: 0,
            duration: 0.75,
            ease: 'back.out(1.4)',
          },
          '-=0.4'
        );
      }

      // 4. Quick Symptoms Pills stagger
      if (pillsRef.current) {
        const pills = pillsRef.current.querySelectorAll('button');
        tl.from(
          pills,
          {
            scale: 0.85,
            opacity: 0,
            duration: 0.45,
            stagger: 0.06,
            ease: 'back.out(1.8)',
          },
          '-=0.3'
        );
      }

      // 5. Trust Micro-Badges slide in
      if (trustRef.current) {
        const badges = trustRef.current.querySelectorAll('.trust-badge');
        tl.from(
          badges,
          {
            x: -16,
            opacity: 0,
            duration: 0.5,
            stagger: 0.1,
          },
          '-=0.2'
        );
      }

      // 6. Stats cards entrance with ScrollTrigger
      if (statsRef.current) {
        const statCards = statsRef.current.querySelectorAll('.stat-card');
        gsap.from(statCards, {
          y: 30,
          opacity: 0,
          duration: 0.75,
          stagger: 0.15,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: statsRef.current,
            start: 'top 88%',
            once: true,
          },
        });
      }

      // 7. Specialties cards stagger with ScrollTrigger
      if (specialtiesRef.current) {
        const cards = specialtiesRef.current.querySelectorAll('.specialty-card');
        gsap.from(cards, {
          y: 40,
          opacity: 0,
          scale: 0.95,
          duration: 0.65,
          stagger: 0.08,
          ease: 'power2.out',
          scrollTrigger: {
            trigger: specialtiesRef.current,
            start: 'top 85%',
            once: true,
          },
        });
      }

      // 8. How It Works steps animation
      if (howItWorksRef.current) {
        const steps = howItWorksRef.current.querySelectorAll('.how-step');
        gsap.from(steps, {
          y: 35,
          opacity: 0,
          duration: 0.7,
          stagger: 0.15,
          ease: 'back.out(1.5)',
          scrollTrigger: {
            trigger: howItWorksRef.current,
            start: 'top 82%',
            once: true,
          },
        });
      }
    },
    { scope: heroRef }
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
    <div ref={heroRef} className="space-y-20 pb-16">
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
            <div
              ref={badgeRef}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-xs font-semibold shadow-sm"
            >
              <Award className="w-4 h-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              <span>{t.hero.badge}</span>
            </div>

            <h1
              ref={titleRef}
              className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white leading-[1.1]"
            >
              Instant Healthcare,{' '}
              <span className="bg-gradient-to-r from-teal-600 via-cyan-500 to-teal-500 bg-clip-text text-transparent">
                Trusted Doctors
              </span>{' '}
              &amp; Ambulance Dispatch
            </h1>

            <p
              ref={subtitleRef}
              className="text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto lg:mx-0 leading-relaxed"
            >
              {t.hero.subtitle}
            </p>

            {/* Symptom Search Bar with GSAP focus micro-interaction */}
            <form
              ref={searchBarRef}
              onSubmit={handleSearch}
              className="max-w-2xl mx-auto lg:mx-0"
            >
              <label htmlFor="hero-symptom-search" className="visually-hidden">
                Search doctors, specialties, or symptoms
              </label>
              <div className="relative flex items-center p-2 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-xl border border-slate-200 dark:border-slate-800 focus-within:ring-2 focus-within:ring-teal-500 focus-within:border-teal-500 transition-all">
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
                  className="shrink-0 px-5 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 active:scale-95 text-white font-semibold text-sm shadow-md transition-all flex items-center gap-1.5"
                >
                  <Zap className="w-4 h-4" aria-hidden="true" />
                  {t.hero.searchButton}
                </button>
              </div>
            </form>

            {/* Quick Symptoms Pills */}
            <div
              ref={pillsRef}
              className="flex flex-wrap items-center justify-center lg:justify-start gap-2 text-xs text-slate-500 dark:text-slate-400"
            >
              <span className="font-semibold text-slate-700 dark:text-slate-300">Popular symptoms:</span>
              {['Fever', 'Skin Rash', 'Persistent Cough', 'Migraine', 'Joint Pain'].map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => router.push(`/doctors?q=${encodeURIComponent(sym)}`)}
                  className="symptom-pill px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 hover:bg-teal-50 hover:text-teal-700 dark:hover:bg-teal-950/80 hover:scale-105 active:scale-95 transition-all shadow-sm"
                >
                  {sym}
                </button>
              ))}
            </div>

            {/* Trust Micro-Badges */}
            <div
              ref={trustRef}
              className="pt-2 flex flex-wrap items-center justify-center lg:justify-start gap-5 text-xs text-slate-600 dark:text-slate-400 font-medium"
            >
              <span className="trust-badge inline-flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-teal-600" aria-hidden="true" />
                Redis Atomic Hold Locks
              </span>
              <span className="trust-badge inline-flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-cyan-600" aria-hidden="true" />
                Live Vitals &amp; Diagnostic Labs
              </span>
              <span className="trust-badge inline-flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-rose-600" aria-hidden="true" />
                &lt; 8 Min EMS Dispatch
              </span>
            </div>
          </div>

          {/* Right Column: Interactive Three.js 3D Bio-Helix with GSAP Floating Telemetry Badges */}
          <div className="lg:col-span-5 relative">
            <MedicalHelixCanvas />

            {/* Floating GSAP Telemetry Overlay Badge - Top Left */}
            <FloatingElement
              yOffset={8}
              duration={3.5}
              className="absolute -top-3 -left-3 sm:top-2 sm:left-2 z-10 hidden sm:block pointer-events-none"
            >
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-teal-500/40 text-teal-300 text-xs font-semibold backdrop-blur-md shadow-lg">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500" />
                </span>
                <span>Live Telemetry 99.98%</span>
              </div>
            </FloatingElement>

            {/* Floating GSAP Telemetry Overlay Badge - Bottom Right */}
            <FloatingElement
              yOffset={10}
              delay={0.7}
              duration={4}
              className="absolute -bottom-3 -right-3 sm:bottom-4 sm:right-3 z-10 hidden sm:block pointer-events-none"
            >
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-rose-500/40 text-rose-300 text-xs font-semibold backdrop-blur-md shadow-lg">
                <Heart className="w-3.5 h-3.5 text-rose-400 animate-pulse" aria-hidden="true" />
                <span>ECG 72 BPM Synced</span>
              </div>
            </FloatingElement>
          </div>
        </div>

        {/* Stats Row with GSAP Animated Counters */}
        <div
          ref={statsRef}
          className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6 pt-8 border-t border-slate-200 dark:border-slate-800"
        >
          <div className="stat-card p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-3xl font-extrabold text-teal-600 dark:text-teal-400 tabular-nums">
              <AnimatedCounter value={45000} suffix="+" />
            </p>
            <p className="text-xs text-slate-500 mt-1 font-medium">Completed with 4.9★ rating</p>
          </div>
          <div className="stat-card p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-3xl font-extrabold text-teal-600 dark:text-teal-400 tabular-nums">
              <AnimatedCounter value={1200} suffix="+" />
            </p>
            <p className="text-xs text-slate-500 mt-1 font-medium">NMC Board-Verified Specialists</p>
          </div>
          <div className="stat-card p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 shadow-sm hover:shadow-md transition-shadow">
            <p className="text-3xl font-extrabold text-rose-600 dark:text-rose-400 tabular-nums">
              <AnimatedCounter value={8} prefix="< " suffix=" Min" />
            </p>
            <p className="text-xs text-slate-500 mt-1 font-medium">Live GPS Ambulance Dispatch</p>
          </div>
        </div>
      </section>

      {/* Specialties Grid with GSAP 3D Interactive Tilt Cards */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <GsapReveal direction="up" className="flex items-center justify-between mb-8">
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
        </GsapReveal>

        <div ref={specialtiesRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {specialties.map((spec) => {
            const Icon = spec.icon;
            return (
              <GsapCard
                key={spec.name}
                tiltMax={6}
                scaleHover={1.02}
                className="specialty-card"
              >
                <Link
                  href={`/doctors?specialty=${encodeURIComponent(spec.name)}`}
                  className="group block p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-teal-500/60 hover:shadow-xl transition-all h-full"
                >
                  <div className="flex items-start justify-between">
                    <div className="w-12 h-12 rounded-xl bg-teal-50 dark:bg-teal-950 text-teal-600 dark:text-teal-400 flex items-center justify-center group-hover:bg-teal-600 group-hover:text-white group-hover:rotate-6 transition-all duration-300">
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
              </GsapCard>
            );
          })}
        </div>
      </section>

      {/* How It Works Section with GSAP Stagger Steps */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 bg-gradient-to-b from-teal-50/60 to-transparent dark:from-teal-950/25 rounded-3xl border border-teal-100 dark:border-teal-900/40">
        <GsapReveal direction="up" className="text-center max-w-2xl mx-auto mb-10">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">How MediBook Telehealth Operates</h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Zero double-booking guarantee with real-time hold locks and compliant video care
          </p>
        </GsapReveal>

        <div ref={howItWorksRef} className="grid grid-cols-1 md:grid-cols-4 gap-6 relative">
          <div className="how-step text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg mx-auto shadow-md hover:scale-110 transition-transform">
              1
            </div>
            <h3 className="font-semibold text-sm text-slate-900 dark:text-white mt-4 flex items-center justify-center gap-1.5">
              <span>Search &amp; Match</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">AI-assisted symptom search matching verified board doctors.</p>
          </div>
          <div className="how-step text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg mx-auto shadow-md hover:scale-110 transition-transform">
              2
            </div>
            <h3 className="font-semibold text-sm text-slate-900 dark:text-white mt-4 flex items-center justify-center gap-1.5">
              <span>10-Min Hold Lease</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">Redis lease reserves your slot exclusively with zero double-booking.</p>
          </div>
          <div className="how-step text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg mx-auto shadow-md hover:scale-110 transition-transform">
              3
            </div>
            <h3 className="font-semibold text-sm text-slate-900 dark:text-white mt-4 flex items-center justify-center gap-1.5">
              <span>HD Video &amp; Vitals</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">Encrypted LiveKit consultation with real-time vitals telemetry.</p>
          </div>
          <div className="how-step text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg mx-auto shadow-md hover:scale-110 transition-transform">
              4
            </div>
            <h3 className="font-semibold text-sm text-slate-900 dark:text-white mt-4 flex items-center justify-center gap-1.5">
              <span>Rx &amp; Lab Orders</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">Doctor issues immutable digital Rx and diagnostic lab orders.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
