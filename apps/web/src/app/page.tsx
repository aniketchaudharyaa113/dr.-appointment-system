'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';
import { gsap, useGSAP, isReducedMotion } from '@/lib/gsap';
import { AnimatedCounter } from '@/components/gsap/animated-counter';
import { HeroOrbitalHub } from '@/components/home/hero-orbital-hub';
import { ServicesShowcase } from '@/components/home/services-showcase';
import {
  EmergencyCardSpotlight,
  InsidePlatformShowcase,
  DualComparisonAndSteps,
  BuiltAroundTimeAndDirectory,
} from '@/components/home/landing-sections';
import {
  Search,
  MapPin,
  Stethoscope,
  Heart,
  Baby,
  Sparkles,
  Brain,
  Ambulance,
} from 'lucide-react';

const SEARCH_TABS = [
  { id: 'All', label: 'All', icon: Search, specialty: '' },
  { id: 'General', label: 'General', icon: Stethoscope, specialty: 'General Medicine' },
  { id: 'Cardiology', label: 'Cardiology', icon: Heart, specialty: 'Cardiology' },
  { id: 'Pediatrics', label: 'Pediatrics', icon: Baby, specialty: 'Pediatrics' },
  { id: 'Dermatology', label: 'Skin & Care', icon: Sparkles, specialty: 'Dermatology' },
  { id: 'Neurology', label: 'Neurology', icon: Brain, specialty: 'Neurology' },
];

export default function HomePage() {
  const { t } = useI18n();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('All');
  const [symptomQuery, setSymptomQuery] = useState('');

  const pageRef = useRef<HTMLDivElement>(null);
  const heroLeftRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (isReducedMotion() || !heroLeftRef.current) return;
      const items = heroLeftRef.current.querySelectorAll('.hero-stagger');
      if (items.length > 0) {
        gsap.fromTo(
          items,
          { y: 12, opacity: 0.94 },
          {
            y: 0,
            opacity: 1,
            duration: 0.5,
            stagger: 0.05,
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
    const params = new URLSearchParams();
    const selectedTab = SEARCH_TABS.find((item) => item.id === activeTab);
    if (selectedTab?.specialty) {
      params.set('specialty', selectedTab.specialty);
    }
    if (symptomQuery.trim()) {
      params.set('q', symptomQuery.trim());
    }
    const qs = params.toString();
    router.push(qs ? `/doctors?${qs}` : '/doctors');
  };

  return (
    <div ref={pageRef}>
      {/* Hero Section */}
      <section className="relative bg-clinical-grid pt-10 pb-16 sm:pt-14 sm:pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left Column */}
            <div ref={heroLeftRef} className="lg:col-span-6 space-y-7 text-center lg:text-left">
              <div className="hero-stagger inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/80 dark:border-emerald-800/70 text-[#146C43] dark:text-emerald-300 text-xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                <span>Doctors · Live Video · Health Passport · EMS — one app</span>
              </div>

              <h1
                className="hero-stagger font-display font-extrabold tracking-tight text-[#132238] dark:text-white leading-[1.06]"
                style={{ fontSize: 'clamp(2.4rem, 1.5rem + 2.8vw, 3.85rem)' }}
              >
                Your health,
                <br />
                <span className="text-[#22A06B] dark:text-emerald-400">one tap away.</span>
              </h1>

              <p className="hero-stagger text-sm sm:text-base text-[#52637A] dark:text-slate-300 max-w-xl mx-auto lg:mx-0 leading-relaxed">
                {t.hero.subtitle}
              </p>

              {/* Integrated Tabbed Search Card */}
              <div className="hero-stagger p-3 rounded-3xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 shadow-[0_14px_40px_-14px_rgba(19,34,56,0.12)] max-w-xl mx-auto lg:mx-0 space-y-3">
                <div className="flex flex-wrap items-center gap-1.5 px-1">
                  {SEARCH_TABS.map((tab) => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`no-touch-target inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                          active
                            ? 'bg-[#14533C] text-white shadow-sm'
                            : 'text-[#52637A] dark:text-slate-300 hover:bg-[#F4FAF7] dark:hover:bg-[#182E25]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                <form
                  onSubmit={handleSearch}
                  className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1 border-t border-[#EDF3EF] dark:border-emerald-950/80"
                >
                  <label htmlFor="hero-symptom-search" className="visually-hidden">
                    Search doctors, specialties, or symptoms
                  </label>
                  <div className="flex items-center flex-1 px-2">
                    <Search className="w-4 h-4 text-[#52637A] shrink-0" aria-hidden="true" />
                    <input
                      id="hero-symptom-search"
                      type="text"
                      value={symptomQuery}
                      onChange={(e) => setSymptomQuery(e.target.value)}
                      placeholder={t.hero.searchPlaceholder}
                      className="w-full bg-transparent border-none px-2.5 py-2 text-xs sm:text-sm text-[#132238] dark:text-white placeholder-[#7B8B9E] focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2 px-1">
                    <Link
                      href="/doctors"
                      className="no-touch-target inline-flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-semibold text-[#52637A] dark:text-slate-300 hover:text-emerald-700"
                    >
                      <MapPin className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                      <span>Kolkata</span>
                    </Link>
                    <button
                      type="submit"
                      className="no-touch-target px-5 py-2.5 rounded-xl bg-[#14533C] hover:bg-[#0F3F2D] text-white font-bold text-xs sm:text-sm shadow-sm transition-colors"
                    >
                      Search
                    </button>
                  </div>
                </form>
              </div>

              {/* Clean Metric Strip (no heavy boxes) */}
              <div className="hero-stagger space-y-2.5 pt-1">
                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-8 sm:gap-12">
                  <div>
                    <p className="font-display text-2xl sm:text-3xl font-extrabold text-[#132238] dark:text-white tabular-nums">
                      <AnimatedCounter value={1200} suffix="+" />
                    </p>
                    <p className="text-xs text-[#52637A] dark:text-slate-400 font-medium">Verified Doctors</p>
                  </div>
                  <div>
                    <p className="font-display text-2xl sm:text-3xl font-extrabold text-[#132238] dark:text-white tabular-nums">
                      <AnimatedCounter value={50} suffix="k+" />
                    </p>
                    <p className="text-xs text-[#52637A] dark:text-slate-400 font-medium">Consultations</p>
                  </div>
                  <div>
                    <p className="font-display text-2xl sm:text-3xl font-extrabold text-[#132238] dark:text-white tabular-nums">
                      <AnimatedCounter value={8} prefix="< " suffix=" min" />
                    </p>
                    <p className="text-xs text-[#52637A] dark:text-slate-400 font-medium">Avg EMS Arrival</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 text-[11px] text-[#52637A] dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
                    Live on CuraBridge · real-time doctor availability &amp; instant holds
                  </span>
                  <Link
                    href="/emergency"
                    className="inline-flex items-center gap-1 font-bold text-rose-600 dark:text-rose-400 hover:underline"
                  >
                    <Ambulance className="w-3.5 h-3.5" aria-hidden="true" />
                    Emergency SOS (112)
                  </Link>
                </div>
              </div>
            </div>

            {/* Right Column: Clean Orbital Care Hub */}
            <div className="lg:col-span-6">
              <HeroOrbitalHub />
            </div>
          </div>
        </div>
      </section>

      <ServicesShowcase />
      <EmergencyCardSpotlight />
      <InsidePlatformShowcase />
      <DualComparisonAndSteps />
      <BuiltAroundTimeAndDirectory />
    </div>
  );
}
