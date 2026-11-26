'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { fetchApi, getCurrentUser, getIstDateOffset } from '@/lib/api';
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
  AlertCircle,
} from 'lucide-react';

interface DoctorProfile {
  id: string;
  specialty: string;
  qualifications?: string | null;
  experienceYears: number;
  clinicName?: string | null;
  clinicAddress?: string | null;
  consultationFeePaise: number;
  licenseNumber?: string | null;
  averageRating: number;
  reviewCount: number;
  reviews?: Array<{
    id: string;
    rating: number;
    comment?: string | null;
    patientName: string;
    createdAt: string;
  }>;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

interface GeneratedSlot {
  slotTime: string;
  displayTime: string;
  isAvailable: boolean;
  isHeld: boolean;
  isBooked: boolean;
  isOnLeave: boolean;
}

export default function DoctorProfilePage() {
  const { t } = useI18n();
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const doctorId = params?.id as string;

  const dateTabs = [
    { key: getIstDateOffset(0), label: 'Today' },
    { key: getIstDateOffset(1), label: 'Tomorrow' },
    { key: getIstDateOffset(2), label: 'In 2 Days' },
  ];

  const [selectedDate, setSelectedDate] = useState<string>(dateTabs[1].key);
  const [selectedSlot, setSelectedSlot] = useState<GeneratedSlot | null>(null);
  const [holdData, setHoldData] = useState<{
    holdToken: string;
    expiresAt: string;
    slotTime: string;
  } | null>(null);
  const [holdSecondsLeft, setHoldSecondsLeft] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);

  const doctorQuery = useQuery<DoctorProfile>({
    queryKey: ['doctor', doctorId],
    queryFn: () => fetchApi<DoctorProfile>(`/doctors/${doctorId}`),
    enabled: !!doctorId,
  });

  const slotsQuery = useQuery<GeneratedSlot[]>({
    queryKey: ['doctor-slots', doctorId, selectedDate],
    queryFn: () => fetchApi<GeneratedSlot[]>(`/doctors/${doctorId}/slots?date=${selectedDate}`),
    enabled: !!doctorId && !!selectedDate,
  });

  // Countdown from real server hold expiresAt
  useEffect(() => {
    if (!holdData) {
      setHoldSecondsLeft(0);
      return;
    }
    const updateTimer = () => {
      const diff = Math.max(0, Math.floor((new Date(holdData.expiresAt).getTime() - Date.now()) / 1000));
      setHoldSecondsLeft(diff);
      if (diff === 0) {
        setHoldData(null);
        setSelectedSlot(null);
        queryClient.invalidateQueries({ queryKey: ['doctor-slots', doctorId, selectedDate] });
      }
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [holdData, doctorId, selectedDate, queryClient]);

  const holdMutation = useMutation({
    mutationFn: (slot: GeneratedSlot) =>
      fetchApi<{ holdToken: string; expiresAt: string; slotTime: string }>('/appointments/hold', {
        method: 'POST',
        body: JSON.stringify({
          doctorId,
          slotTime: slot.slotTime,
          consultationMode: 'VIDEO',
        }),
      }),
    onSuccess: (res, slot) => {
      setActionError(null);
      setSelectedSlot(slot);
      setHoldData(res);
    },
    onError: (err: Error) => {
      setActionError(err.message);
      queryClient.invalidateQueries({ queryKey: ['doctor-slots', doctorId, selectedDate] });
    },
  });

  const bookMutation = useMutation({
    mutationFn: () => {
      if (!holdData) throw new Error('No active slot hold');
      return fetchApi<{ id: string; bookingRef: string; status: string }>('/appointments/book', {
        method: 'POST',
        body: JSON.stringify({
          doctorId,
          slotTime: holdData.slotTime,
          holdToken: holdData.holdToken,
          consultationMode: 'VIDEO',
          idempotencyKey: crypto.randomUUID(),
        }),
      });
    },
    onSuccess: (appt) => {
      router.push(`/checkout/${appt.id}`);
    },
    onError: (err: Error) => {
      setActionError(err.message);
    },
  });

  const handleSelectSlot = (slot: GeneratedSlot) => {
    if (!slot.isAvailable) return;
    setActionError(null);
    const user = getCurrentUser();
    if (!user?.token) {
      router.push(`/auth/login?redirect=${encodeURIComponent(`/doctors/${doctorId}`)}`);
      return;
    }
    holdMutation.mutate(slot);
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (doctorQuery.isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12 text-center text-sm text-slate-500">
        Loading doctor profile...
      </div>
    );
  }

  if (doctorQuery.isError || !doctorQuery.data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <p className="text-sm font-bold text-rose-600">
          {(doctorQuery.error as Error)?.message || 'Doctor not found'}
        </p>
        <Link href="/doctors" className="text-xs font-semibold text-teal-600 underline">
          Return to Doctor Directory
        </Link>
      </div>
    );
  }

  const doctor = doctorQuery.data;
  const slots = slotsQuery.data ?? [];
  const initials = doctor.user.name.replace(/^Dr\.\s*/i, '').slice(0, 2).toUpperCase();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <Link
        href="/doctors"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-teal-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Doctor Directory
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row items-start gap-5">
              <div className="w-20 h-20 rounded-2xl bg-teal-600 text-white font-extrabold text-2xl flex items-center justify-center shrink-0 shadow-md">
                {initials}
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{doctor.user.name}</h1>
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 rounded-full">
                    <CheckCircle className="w-3.5 h-3.5" /> NMC Verified ({doctor.licenseNumber || 'Verified'})
                  </span>
                </div>
                {doctor.qualifications && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{doctor.qualifications}</p>
                )}
                <p className="text-sm font-semibold text-teal-600 dark:text-teal-400">
                  {doctor.specialty} • {doctor.experienceYears} Years Clinical Experience
                </p>
                <div className="flex items-center gap-4 text-xs pt-1">
                  <span className="flex items-center gap-1 font-bold text-amber-500">
                    <Star className="w-4 h-4 fill-current" />{' '}
                    {doctor.reviewCount > 0 ? doctor.averageRating.toFixed(1) : 'New'}
                    <span className="text-slate-400 font-normal">({doctor.reviewCount} verified reviews)</span>
                  </span>
                  {doctor.clinicName && (
                    <>
                      <span className="text-slate-400">•</span>
                      <span className="text-slate-500">{doctor.clinicName}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1">
                  <Building className="w-3.5 h-3.5 text-teal-600" /> Clinic Chamber
                </span>
                <p className="text-xs text-slate-500">{doctor.clinicAddress || 'Kolkata Telehealth Center'}</p>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-1">
                  <Video className="w-3.5 h-3.5 text-teal-600" /> Telehealth Facility
                </span>
                <p className="text-xs text-slate-500">HD Encrypted LiveKit Consultation with instant digital Rx</p>
              </div>
            </div>

            {/* Patient Reviews Section */}
            <div className="pt-6 border-t border-slate-100 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-500 fill-current" />
                  Verified Patient Reviews
                </h3>
                <span className="text-xs text-slate-400 font-medium">
                  {doctor.reviewCount > 0
                    ? `${doctor.averageRating.toFixed(1)} / 5.0 (${doctor.reviewCount} total)`
                    : 'No reviews yet'}
                </span>
              </div>

              {doctor.reviews && doctor.reviews.length > 0 ? (
                <div className="space-y-3">
                  {doctor.reviews.map((r: any) => (
                    <div
                      key={r.id}
                      className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/60 dark:border-slate-700/60 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {r.patientName || 'Verified Patient'}
                        </span>
                        <div className="flex items-center gap-0.5 text-amber-500">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={`w-3 h-3 ${i < r.rating ? 'fill-current' : 'text-slate-300 dark:text-slate-600'}`}
                            />
                          ))}
                        </div>
                      </div>
                      {r.comment && (
                        <p className="text-xs text-slate-600 dark:text-slate-300">{r.comment}</p>
                      )}
                      <span className="text-[10px] text-slate-400 block">
                        {new Date(r.createdAt).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">
                  Be the first patient to review Dr. {doctor.user.name} after your consultation!
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Slot Picker & Redis Hold */}
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
              {dateTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    setSelectedDate(tab.key);
                    setSelectedSlot(null);
                    setHoldData(null);
                    setActionError(null);
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

            {actionError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            {/* Slots Grid */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                Available Time Slots ({selectedDate})
              </label>

              {slotsQuery.isLoading ? (
                <div className="grid grid-cols-2 gap-2.5">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-10 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
                  ))}
                </div>
              ) : slots.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">
                  No consultation slots configured for this date.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                  {slots.map((slot) => {
                    const isSelected = selectedSlot?.slotTime === slot.slotTime;
                    return (
                      <button
                        key={slot.slotTime}
                        type="button"
                        disabled={!slot.isAvailable || holdMutation.isPending}
                        onClick={() => handleSelectSlot(slot)}
                        className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all ${
                          !slot.isAvailable
                            ? 'border-slate-200 dark:border-slate-800 text-slate-300 dark:text-slate-700 bg-slate-50 dark:bg-slate-900/40 cursor-not-allowed line-through'
                            : isSelected
                              ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 ring-2 ring-teal-500/30'
                              : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:border-teal-500/50 bg-white dark:bg-slate-900'
                        }`}
                      >
                        <span>{slot.displayTime}</span>
                        {isSelected ? (
                          <CheckCircle className="w-3.5 h-3.5 text-teal-600" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 opacity-40" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Active Redis Hold Banner */}
            {holdData && selectedSlot && holdSecondsLeft > 0 && (
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 space-y-2 text-amber-900 dark:text-amber-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-600" />
                    Slot Held Temporarily
                  </span>
                  <span className="text-sm font-mono font-extrabold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 rounded">
                    {formatTimer(holdSecondsLeft)}
                  </span>
                </div>
                <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 leading-relaxed">
                  Slot <span className="font-bold">{selectedSlot.displayTime} IST</span> is locked in Redis exclusively for you. Complete booking & payment before expiration.
                </p>
              </div>
            )}

            <button
              type="button"
              disabled={!holdData || holdSecondsLeft === 0 || bookMutation.isPending}
              onClick={() => bookMutation.mutate()}
              className="w-full py-3.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
            >
              <span>{bookMutation.isPending ? 'Creating Booking...' : t.doctors.proceedToPay}</span>
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
