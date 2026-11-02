'use client';

import React, { useState } from 'react';
import Link from 'next/link';
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
} from 'lucide-react';

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
    { name: 'General Physician', icon: Stethoscope, count: '320+ Doctors', desc: 'Fever, cold, viral infections, lifestyle health' },
    { name: 'Cardiology', icon: Heart, count: '94 Doctors', desc: 'Blood pressure, chest discomfort, heart health' },
    { name: 'Dermatology', icon: Sparkles, count: '142 Doctors', desc: 'Acne, skin allergy, eczema, hair loss' },
    { name: 'Neurology', icon: Brain, count: '65 Doctors', desc: 'Migraine, nerve disorders, chronic headache' },
    { name: 'Pediatrics', icon: Baby, count: '110 Doctors', desc: 'Child vaccination, infant fever, nutrition' },
    { name: 'Orthopedics', icon: Bone, count: '88 Doctors', desc: 'Joint pain, fractures, spine & sports injury' },
  ];

  return (
    <div className="space-y-16 pb-12">
      {/* Emergency Banner */}
      <div className="bg-rose-600 text-white py-2.5 px-4 text-xs font-semibold shadow-inner">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-200 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            <span>Experiencing severe chest pain, shortness of breath, or trauma?</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="tel:112" className="underline hover:text-rose-100 flex items-center gap-1">
              <PhoneCall className="w-3.5 h-3.5" /> Call National Emergency 112
            </a>
            <span>|</span>
            <Link href="/emergency" className="bg-white text-rose-700 px-2.5 py-1 rounded font-bold hover:bg-rose-50 transition-colors">
              Dispatch Ambulance
            </Link>
          </div>
        </div>
      </div>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-12 text-center">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300 text-xs font-semibold mb-6">
          <Award className="w-4 h-4" />
          <span>{t.hero.badge}</span>
        </div>

        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 dark:text-white max-w-4xl mx-auto leading-tight">
          Instant Healthcare, <span className="text-teal-600 dark:text-teal-400">Trusted Doctors</span> & Ambulance Dispatch
        </h1>

        <p className="mt-5 text-base sm:text-lg text-slate-600 dark:text-slate-400 max-w-2xl mx-auto leading-relaxed">
          {t.hero.subtitle}
        </p>

        {/* Symptom Search Bar */}
        <form onSubmit={handleSearch} className="mt-8 max-w-2xl mx-auto">
          <div className="relative flex items-center p-2 rounded-2xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200 dark:border-slate-800 focus-within:ring-2 focus-within:ring-teal-500">
            <Search className="w-5 h-5 text-slate-400 ml-3 shrink-0" />
            <input
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
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-300">Popular symptoms:</span>
          {['Fever', 'Skin Rash', 'Persistent Cough', 'Migraine', 'Joint Pain'].map((sym) => (
            <button
              key={sym}
              onClick={() => router.push(`/doctors?q=${encodeURIComponent(sym)}`)}
              className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 hover:bg-teal-50 hover:text-teal-700 dark:hover:bg-teal-950/80 transition-colors"
            >
              {sym}
            </button>
          ))}
        </div>

        {/* Stats Row */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-3xl mx-auto pt-8 border-t border-slate-200 dark:border-slate-800">
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 shadow-sm">
            <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">{t.hero.statPatients}</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">Completed with 4.9★ rating</p>
          </div>
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 shadow-sm">
            <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">{t.hero.statDoctors}</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">NMC Board-Verified Specialists</p>
          </div>
          <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 shadow-sm">
            <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{t.hero.statResponse}</p>
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
            View all specialties <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {specialties.map((spec) => {
            const Icon = spec.icon;
            return (
              <Link
                key={spec.name}
                href={`/doctors?specialty=${encodeURIComponent(spec.name)}`}
                className="group p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-teal-500/60 hover:shadow-lg transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="w-12 h-12 rounded-xl bg-teal-50 dark:bg-teal-950 text-teal-600 dark:text-teal-400 flex items-center justify-center group-hover:bg-teal-600 group-hover:text-white transition-colors">
                    <Icon className="w-6 h-6" />
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
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 bg-gradient-to-b from-teal-50/50 to-transparent dark:from-teal-950/20 rounded-3xl border border-teal-100 dark:border-teal-900/40">
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
            <h4 className="font-semibold text-sm text-slate-900 dark:text-white mt-4">Search & Match</h4>
            <p className="text-xs text-slate-500 mt-1">AI-assisted symptom search matching verified board doctors.</p>
          </div>
          <div className="text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg mx-auto shadow-md">
              2
            </div>
            <h4 className="font-semibold text-sm text-slate-900 dark:text-white mt-4">10-Min Hold Lease</h4>
            <p className="text-xs text-slate-500 mt-1">Redis lease reserves your slot exclusively with zero double-booking.</p>
          </div>
          <div className="text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg mx-auto shadow-md">
              3
            </div>
            <h4 className="font-semibold text-sm text-slate-900 dark:text-white mt-4">HD LiveKit Video</h4>
            <p className="text-xs text-slate-500 mt-1">Join encrypted consultation inside the doctor join window.</p>
          </div>
          <div className="text-center p-4">
            <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-lg mx-auto shadow-md">
              4
            </div>
            <h4 className="font-semibold text-sm text-slate-900 dark:text-white mt-4">Digital Prescription</h4>
            <p className="text-xs text-slate-500 mt-1">Doctor issues immutable versioned digital Rx immediately after visit.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
