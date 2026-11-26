'use client';

import React, { useState, Suspense, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { fetchApi, formatIstDateTime } from '@/lib/api';
import { formatPaise } from '@/lib/utils';
import { gsap, useGSAP, isReducedMotion } from '@/lib/gsap';
import {
  Search,
  Filter,
  CheckCircle,
  Star,
  Video,
  ChevronRight,
  Clock,
  Sparkles,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';

interface DoctorApiItem {
  id: string;
  name: string;
  email: string;
  specialty: string;
  qualifications?: string | null;
  experienceYears: number;
  clinicName?: string | null;
  clinicAddress?: string | null;
  consultationFeePaise: number;
  averageRating: number;
  reviewCount: number;
  distanceKm: number | null;
  nextAvailableSlot: string | null;
  photoUrl?: string | null;
}

interface DoctorSearchResponse {
  data: DoctorApiItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function DoctorsListContent() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const initialSpecialty = searchParams.get('specialty') || 'All';

  const [query, setQuery] = useState(initialQuery);
  const [selectedSpecialty, setSelectedSpecialty] = useState(initialSpecialty);
  const [maxFeeInr, setMaxFeeInr] = useState<number>(2000);
  const [sortBy, setSortBy] = useState<'FEE_ASC' | 'RATING_DESC' | 'EXPERIENCE_DESC'>('EXPERIENCE_DESC');

  const specialtiesList = [
    'All',
    'General Medicine',
    'Cardiology',
    'Dermatology',
    'Pediatrics',
    'Neurology',
    'Orthopedics',
  ];

  const { data, isLoading, isError, error, refetch } = useQuery<DoctorSearchResponse>({
    queryKey: ['doctors', query, selectedSpecialty, maxFeeInr, sortBy],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (query.trim()) qs.set('symptom', query.trim());
      if (selectedSpecialty !== 'All') qs.set('specialty', selectedSpecialty);
      qs.set('maxFeePaise', String(maxFeeInr * 100));
      qs.set('sortBy', sortBy);
      qs.set('limit', '20');
      return fetchApi<DoctorSearchResponse>(`/doctors?${qs.toString()}`);
    },
  });

  const doctors = data?.data ?? [];
  const doctorsListRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (isReducedMotion() || !doctorsListRef.current) return;
      const cards = doctorsListRef.current.querySelectorAll('[data-testid="doctor-card"]');
      if (cards.length > 0) {
        gsap.from(cards, {
          y: 20,
          opacity: 0,
          stagger: 0.05,
          duration: 0.45,
          ease: 'power2.out',
        });
      }
    },
    { scope: doctorsListRef, dependencies: [doctors] }
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">{t.doctors.title}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          NMC-registered medical doctors with Redis 10-minute slot holding and live telemedicine
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Filter Sidebar */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6 h-fit">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <Filter className="w-4 h-4 text-teal-600" />
              Filter Results
            </h3>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setSelectedSpecialty('All');
                setMaxFeeInr(2000);
                setSortBy('EXPERIENCE_DESC');
              }}
              className="text-xs text-teal-600 dark:text-teal-400 hover:underline"
            >
              Reset
            </button>
          </div>

          {/* Specialty */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              {t.doctors.filterSpecialty}
            </label>
            <div className="space-y-1">
              {specialtiesList.map((spec) => (
                <button
                  key={spec}
                  type="button"
                  onClick={() => setSelectedSpecialty(spec)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    selectedSpecialty === spec
                      ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {spec}
                </button>
              ))}
            </div>
          </div>

          {/* Sort */}
          <div>
            <label htmlFor="doctors-sort-by" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Sort By
            </label>
            <select
              id="doctors-sort-by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 border-none"
            >
              <option value="EXPERIENCE_DESC">Most Experienced</option>
              <option value="FEE_ASC">Lowest Consultation Fee</option>
              <option value="RATING_DESC">Highest Rated</option>
            </select>
          </div>

          {/* Max Fee Slider */}
          <div>
            <div className="flex justify-between items-center text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              <label htmlFor="doctors-max-fee">{t.doctors.filterFee}</label>
              <span className="text-teal-600 dark:text-teal-400 font-bold">₹{maxFeeInr}</span>
            </div>
            <input
              id="doctors-max-fee"
              type="range"
              min="300"
              max="2000"
              step="100"
              value={maxFeeInr}
              onChange={(e) => setMaxFeeInr(Number(e.target.value))}
              className="w-full accent-teal-600 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>₹300</span>
              <span>₹2000+</span>
            </div>
          </div>
        </div>

        {/* Doctors Grid */}
        <div className="lg:col-span-3 space-y-4">
          <div className="relative flex items-center p-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <Search className="w-4 h-4 text-slate-400 ml-3" aria-hidden="true" />
            <input
              type="text"
              aria-label="Search doctors or symptoms"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symptoms (e.g. chest pain, skin rash, fever)..."
              className="w-full bg-transparent border-none px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
            />
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse space-y-3"
                >
                  <div className="h-5 w-48 bg-slate-200 dark:bg-slate-800 rounded" />
                  <div className="h-3 w-72 bg-slate-100 dark:bg-slate-800 rounded" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="p-8 text-center bg-rose-50 dark:bg-rose-950/30 rounded-2xl border border-rose-200 dark:border-rose-900 space-y-3">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
              <p className="text-sm font-bold text-rose-700 dark:text-rose-300">
                Failed to load doctors: {(error as Error)?.message}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Retry
              </button>
            </div>
          ) : (
            <>
              <div className="text-xs font-semibold text-slate-500">
                Showing {doctors.length} verified doctors
              </div>

              {doctors.length === 0 ? (
                <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
                  <Sparkles className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <h3 className="font-bold text-slate-700 dark:text-slate-300 text-sm">
                    No doctors match your criteria
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Try clearing your symptom search or widening the fee range.
                  </p>
                </div>
              ) : (
                <div ref={doctorsListRef} className="space-y-4">
                  {doctors.map((doc) => (
                    <div
                      key={doc.id}
                      data-testid="doctor-card"
                      className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-teal-500/50 hover:shadow-md transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5"
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 font-bold text-lg flex items-center justify-center shrink-0">
                          {doc.name.replace(/^Dr\.\s*/i, '').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-base text-slate-900 dark:text-white">
                              {doc.name}
                            </h3>
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                              <CheckCircle className="w-3 h-3" /> NMC Verified
                            </span>
                          </div>
                          <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold">
                            {doc.specialty} • {doc.experienceYears} Years Experience
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {doc.clinicName || 'MediBook Clinic'}
                            {doc.clinicAddress ? ` • ${doc.clinicAddress}` : ''}
                          </p>
                          <div className="flex items-center gap-4 text-xs pt-1">
                            <span className="flex items-center gap-1 font-bold text-amber-500">
                              <Star className="w-3.5 h-3.5 fill-current" />{' '}
                              {doc.reviewCount > 0 ? doc.averageRating.toFixed(1) : 'New'}
                              <span className="text-slate-400 font-normal">({doc.reviewCount})</span>
                            </span>
                            <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[11px] text-slate-500">
                              <Video className="w-3 h-3 text-teal-600" /> Video & Clinic
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="w-full sm:w-auto flex sm:flex-col items-center sm:items-end justify-between gap-3 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800 shrink-0">
                        <div>
                          <span className="text-[10px] text-slate-400 block sm:text-right uppercase font-semibold">
                            {t.doctors.fee}
                          </span>
                          <span className="text-lg font-extrabold text-slate-900 dark:text-white">
                            {formatPaise(doc.consultationFeePaise)}
                          </span>
                        </div>

                        <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>
                            {doc.nextAvailableSlot
                              ? formatIstDateTime(doc.nextAvailableSlot)
                              : 'Check schedule'}
                          </span>
                        </div>

                        <Link
                          href={`/doctors/${doc.id}`}
                          className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs shadow-sm transition-colors"
                        >
                          <span>{t.doctors.bookSlot}</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DoctorsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Loading verified doctors...</div>}>
      <DoctorsListContent />
    </Suspense>
  );
}
