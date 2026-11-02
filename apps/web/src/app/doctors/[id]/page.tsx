'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { formatPaise } from '@/lib/utils';
import {
  CheckCircle,
  Star,
  Video,
  Building,
  Clock,
  ShieldCheck,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';

interface Slot {
  id: string;
  time: string;
  isAvailable: boolean;
}

export default function DoctorProfilePage() {
  const { t } = useI18n();
  const params = useParams();
  const router = useRouter();
  const doctorId = (params?.id as string) || 'doc-1';

  const [selectedDate, setSelectedDate] = useState<'today' | 'tomorrow' | 'day3'>('today');
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [isHolding, setIsHolding] = useState(false);
  const [holdSecondsLeft, setHoldSecondsLeft] = useState<number>(600); // 10 minutes
  const [heldAppointmentId, setHeldAppointmentId] = useState<string | null>(null);

  // Doctor Details
  const doctor = {
    id: doctorId,
    name: 'Dr. Arindam Mukherjee',
    degrees: 'MBBS, MD (Cardiology), DM (Interventional Cardiology), FACC',
    regNumber: 'WBMC/64921',
    specialty: 'Cardiology',
    experienceYears: 16,
    consultationFeePaise: 80000,
    rating: 4.9,
    reviewCount: 184,
    hospitalAffiliation: 'Apollo Gleneagles Hospitals, Kolkata',
    clinicAddress: '58 Canal Circular Road, Kadapara, Phool Bagan, Kankurgachi, Kolkata, WB 700054',
    about:
      'Dr. Arindam Mukherjee is a Senior Consultant Interventional Cardiologist in Kolkata with over 16 years of clinical experience specializing in complex coronary interventions, hypertension management, preventive cardiology, and post-infarction care. Member of the Cardiological Society of India (CSI).',
  };

  const slotsMap: Record<string, Slot[]> = {
    today: [
      { id: 's-101', time: '05:00 PM', isAvailable: true },
      { id: 's-102', time: '05:30 PM', isAvailable: true },
      { id: 's-103', time: '06:00 PM', isAvailable: false },
      { id: 's-104', time: '06:30 PM', isAvailable: true },
      { id: 's-105', time: '07:00 PM', isAvailable: true },
      { id: 's-106', time: '07:30 PM', isAvailable: false },
    ],
    tomorrow: [
      { id: 's-201', time: '10:00 AM', isAvailable: true },
      { id: 's-202', time: '10:30 AM', isAvailable: true },
      { id: 's-203', time: '11:00 AM', isAvailable: true },
      { id: 's-204', time: '11:30 AM', isAvailable: true },
      { id: 's-205', time: '04:00 PM', isAvailable: true },
      { id: 's-206', time: '04:30 PM', isAvailable: false },
    ],
    day3: [
      { id: 's-301', time: '03:00 PM', isAvailable: true },
      { id: 's-302', time: '03:30 PM', isAvailable: true },
      { id: 's-303', time: '04:00 PM', isAvailable: true },
      { id: 's-304', time: '05:00 PM', isAvailable: true },
    ],
  };

  // Hold Countdown Timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isHolding && holdSecondsLeft > 0) {
      interval = setInterval(() => {
        setHoldSecondsLeft((prev) => {
          if (prev <= 1) {
            setIsHolding(false);
            setSelectedSlot(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isHolding, holdSecondsLeft]);

  const handleSelectSlot = (slot: Slot) => {
    if (!slot.isAvailable) return;
    setSelectedSlot(slot);
    setIsHolding(true);
    setHoldSecondsLeft(600); // 10 min hold lease
    setHeldAppointmentId(`apt-${Date.now()}`);
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleProceedToCheckout = () => {
    if (!heldAppointmentId) return;
    router.push(`/checkout/${heldAppointmentId}?docId=${doctor.id}&slot=${selectedSlot?.time}`);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Back button */}
      <Link
        href="/doctors"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-teal-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Doctor Directory
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Doctor Profile Info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row items-start gap-5">
              <div className="w-20 h-20 rounded-2xl bg-teal-600 text-white font-extrabold text-2xl flex items-center justify-center shrink-0 shadow-md">
                AM
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{doctor.name}</h1>
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 rounded-full">
                    <CheckCircle className="w-3.5 h-3.5" /> NMC Verified ({doctor.regNumber})
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{doctor.degrees}</p>
                <p className="text-sm font-semibold text-teal-600 dark:text-teal-400">
                  {doctor.specialty} • {doctor.experienceYears} Years Clinical Experience
                </p>
                <div className="flex items-center gap-4 text-xs pt-1">
                  <span className="flex items-center gap-1 font-bold text-amber-500">
                    <Star className="w-4 h-4 fill-current" /> {doctor.rating}
                    <span className="text-slate-400 font-normal">({doctor.reviewCount} verified reviews)</span>
                  </span>
                  <span className="text-slate-400">•</span>
                  <span className="text-slate-500">{doctor.hospitalAffiliation}</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">About Doctor</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{doctor.about}</p>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1">
                  <Building className="w-3.5 h-3.5 text-teal-600" /> Clinic Chamber
                </span>
                <p className="text-xs text-slate-500">{doctor.clinicAddress}</p>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1">
                  <Video className="w-3.5 h-3.5 text-teal-600" /> Telehealth Facility
                </span>
                <p className="text-xs text-slate-500">HD Encrypted LiveKit Consultation with instant digital Rx</p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Slot Picker & Hold Lease */}
        <div className="space-y-6">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Select Consultation Slot</h2>
                <p className="text-xs text-slate-400">Asia/Kolkata Timezone (IST)</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-400 block">Fee</span>
                <span className="text-xl font-extrabold text-teal-600 dark:text-teal-400">
                  {formatPaise(doctor.consultationFeePaise)}
                </span>
              </div>
            </div>

            {/* Date Tabs */}
            <div className="grid grid-cols-3 gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
              {(
                [
                  { key: 'today', label: 'Today' },
                  { key: 'tomorrow', label: 'Tomorrow' },
                  { key: 'day3', label: 'In 2 Days' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => {
                    setSelectedDate(tab.key);
                    setSelectedSlot(null);
                    setIsHolding(false);
                  }}
                  className={`py-2 rounded-lg text-center transition-all ${
                    selectedDate === tab.key
                      ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-300 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Slots Grid */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                Available Time Slots
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                {slotsMap[selectedDate].map((slot) => {
                  const isSelected = selectedSlot?.id === slot.id;
                  return (
                    <button
                      key={slot.id}
                      disabled={!slot.isAvailable}
                      onClick={() => handleSelectSlot(slot)}
                      className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all ${
                        !slot.isAvailable
                          ? 'border-slate-200 dark:border-slate-800 text-slate-300 dark:text-slate-700 bg-slate-50 dark:bg-slate-900/40 cursor-not-allowed line-through'
                          : isSelected
                            ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 ring-2 ring-teal-500/30'
                            : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:border-teal-500/50 bg-white dark:bg-slate-900'
                      }`}
                    >
                      <span>{slot.time}</span>
                      {isSelected ? (
                        <CheckCircle className="w-3.5 h-3.5 text-teal-600" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 opacity-40" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Hold Banner with Animated Countdown */}
            {isHolding && selectedSlot && (
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-2 text-amber-900 dark:text-amber-200 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-600 animate-spin" style={{ animationDuration: '4s' }} />
                    Slot Held Temporarily
                  </span>
                  <span className="text-sm font-mono font-extrabold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 rounded">
                    {formatTimer(holdSecondsLeft)}
                  </span>
                </div>
                <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
                  Slot <span className="font-bold">{selectedSlot.time}</span> is reserved exclusively for you. Complete payment before expiration.
                </p>
              </div>
            )}

            {/* Action Button */}
            <button
              disabled={!selectedSlot || !isHolding}
              onClick={handleProceedToCheckout}
              className="w-full py-3.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
            >
              <span>{t.doctors.proceedToPay}</span>
              <ChevronRight className="w-4 h-4" />
            </button>

            <div className="text-[11px] text-slate-400 text-center flex items-center justify-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
              100% Refundable if cancelled up to 24h before
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
