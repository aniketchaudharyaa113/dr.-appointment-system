'use client';

import React, { useState } from 'react';
import {
  Stethoscope,
  Video,
  FlaskConical,
  Ambulance,
  CheckCircle2,
  Pause,
  Play,
  ShieldCheck,
} from 'lucide-react';

export function HeroOrbitalHub() {
  const [paused, setPaused] = useState(false);

  return (
    <div
      className={`relative w-full max-w-[520px] mx-auto aspect-square sm:aspect-[1/0.94] flex items-center justify-center select-none ${
        paused ? 'cb-paused' : ''
      }`}
    >
      {/* Subtle radial glow & orbital dashed rings */}
      <div
        className="absolute inset-6 rounded-full bg-gradient-to-br from-emerald-50 via-emerald-50/40 to-transparent dark:from-emerald-950/50 dark:via-emerald-950/20 dark:to-transparent pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute inset-4 sm:inset-6 rounded-full border border-dashed border-emerald-200/90 dark:border-emerald-800/50 pointer-events-none"
        aria-hidden="true"
      />
      <div
        className="absolute inset-14 sm:inset-16 rounded-full border border-emerald-200/70 dark:border-emerald-800/40 pointer-events-none"
        aria-hidden="true"
      />

      {/* Top status pill */}
      <div className="cb-float absolute top-3 sm:top-5 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 shadow-sm text-[11px] font-semibold text-[#132238] dark:text-slate-100 whitespace-nowrap">
        <span className="w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-900/70 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
        </span>
        <span>10-min slot hold active · Live Queue</span>
      </div>

      {/* Center CuraBridge Emblem */}
      <div className="relative z-10 w-36 h-36 sm:w-44 sm:h-44 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 shadow-[0_20px_50px_-12px_rgba(25,135,84,0.45)] flex items-center justify-center border-4 border-white dark:border-[#12221C]">
        <svg viewBox="0 0 120 120" className="w-24 h-24 sm:w-28 sm:h-28" fill="none" aria-hidden="true">
          <path
            d="M60 14L96 28V58C96 81 80.5 99.5 60 106C39.5 99.5 24 81 24 58V28L60 14Z"
            fill="rgba(255,255,255,0.16)"
            stroke="#FFFFFF"
            strokeWidth="4.5"
            strokeLinejoin="round"
          />
          <circle cx="60" cy="48" r="10" fill="#FFFFFF" fillOpacity="0.95" />
          <path
            d="M36 70H47L53 56L62 82L68 70H84"
            stroke="#FFFFFF"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="visually-hidden">CuraBridge Care Hub</span>
      </div>

      {/* 4 Orbital Feature Cards */}
      <div className="cb-float absolute top-[20%] left-0 sm:left-1 z-20 flex items-center gap-2.5 p-2.5 sm:p-3 rounded-2xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 shadow-lg max-w-[168px]">
        <span className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
          <Stethoscope className="w-4 h-4" aria-hidden="true" />
        </span>
        <div className="leading-tight">
          <p className="text-xs font-bold text-[#132238] dark:text-white">Specialists</p>
          <p className="text-[10px] text-[#52637A] dark:text-slate-400">NMC verified slots</p>
        </div>
      </div>

      <div className="cb-float-delayed absolute top-[20%] right-0 sm:right-1 z-20 flex items-center gap-2.5 p-2.5 sm:p-3 rounded-2xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 shadow-lg max-w-[168px]">
        <span className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
          <FlaskConical className="w-4 h-4" aria-hidden="true" />
        </span>
        <div className="leading-tight">
          <p className="text-xs font-bold text-[#132238] dark:text-white">Labs &amp; Vitals</p>
          <p className="text-[10px] text-[#52637A] dark:text-slate-400">Results &amp; history</p>
        </div>
      </div>

      <div className="cb-float-delayed absolute bottom-[18%] left-0 sm:left-1 z-20 flex items-center gap-2.5 p-2.5 sm:p-3 rounded-2xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 shadow-lg max-w-[168px]">
        <span className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
          <Video className="w-4 h-4" aria-hidden="true" />
        </span>
        <div className="leading-tight">
          <p className="text-xs font-bold text-[#132238] dark:text-white">HD Video Rx</p>
          <p className="text-[10px] text-[#52637A] dark:text-slate-400">E-prescriptions</p>
        </div>
      </div>

      <div className="cb-float absolute bottom-[18%] right-0 sm:right-1 z-20 flex items-center gap-2.5 p-2.5 sm:p-3 rounded-2xl bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 shadow-lg max-w-[168px]">
        <span className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0">
          <Ambulance className="w-4 h-4" aria-hidden="true" />
        </span>
        <div className="leading-tight">
          <p className="text-xs font-bold text-[#132238] dark:text-white">EMS Dispatch</p>
          <p className="text-[10px] text-[#52637A] dark:text-slate-400">24/7 Live GPS</p>
        </div>
      </div>

      {/* Bottom status pill + Accessible Pause Button */}
      <div className="cb-float-delayed absolute bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white dark:bg-[#12221C] border border-[#E3ECE7] dark:border-emerald-900/70 shadow-sm text-[11px] font-semibold text-[#132238] dark:text-slate-100 whitespace-nowrap">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" aria-hidden="true" />
        <span>ABDM Passport · Encrypted care</span>
      </div>

      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        aria-label={paused ? 'Play hub float animation' : 'Pause hub float animation'}
        title={paused ? 'Play animation' : 'Pause animation'}
        className="no-touch-target absolute bottom-2 right-2 z-20 p-1.5 rounded-full bg-white/90 dark:bg-[#12221C]/90 border border-[#E3ECE7] dark:border-emerald-900 text-[#52637A] dark:text-slate-300 hover:text-emerald-700 shadow-sm"
      >
        {paused ? <Play className="w-3 h-3" aria-hidden="true" /> : <Pause className="w-3 h-3" aria-hidden="true" />}
      </button>
    </div>
  );
}
