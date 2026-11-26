'use client';

import React, { useState, useEffect, Suspense, useRef } from 'react';
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
  MapPin,
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
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [selectedSpecialty, setSelectedSpecialty] = useState(initialSpecialty);
  const [maxFeeInr, setMaxFeeInr] = useState<number>(2000);
  const [sortBy, setSortBy] = useState<'FEE_ASC' | 'RATING_DESC' | 'EXPERIENCE_DESC'>('EXPERIENCE_DESC');

  // Sync URL query params if user navigates via homepage cards
  useEffect(() => {
    const q = searchParams.get('q') || '';
    const spec = searchParams.get('specialty') || 'All';
    setQuery(q);
    setDebouncedQuery(q);
    setSelectedSpecialty(spec);
  }, [searchParams]);

  // Debounce search text to avoid redundant queries and jitter
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

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
    queryKey: ['doctors', debouncedQuery, selectedSpecialty, maxFeeInr, sortBy],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (debouncedQuery.trim()) qs.set('symptom', debouncedQuery.trim());
      if (selectedSpecialty !== 'All') qs.set('specialty', selectedSpecialty);
      qs.set('maxFeePaise', String(maxFeeInr * 100));
      qs.set('sortBy', sortBy);
      qs.set('limit', '20');
      return fetchApi<DoctorSearchResponse>(`/doctors?${qs.toString()}`);
    },
  });

  const doctors = data?.data ?? [];
  const doctorsKey = doctors.map((d) => d.id).join(',');
  const doctorsListRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (isReducedMotion() || !doctorsListRef.current || !doctorsKey) return;
      const cards = doctorsListRef.current.querySelectorAll('[data-testid="doctor-card"]');
      if (cards.length > 0) {
        gsap.fromTo(
          cards,
          { y: 12, opacity: 0.94 },
          {
            y: 0,
            opacity: 1,
            stagger: 0.04,
            duration: 0.35,
            ease: 'power2.out',
            clearProps: 'transform,opacity',
          },
        );
      }
    },
    { scope: doctorsListRef, dependencies: [doctorsKey] },
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <div className="border-b border-slate-200/80 dark:border-slate-800 pb-6">
        <span className="text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400">
          NMC Verified Directory
        </span>
        <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-slate-900 dark:text-white mt-1">
          {t.doctors.title}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5 max-w-2xl">
          Book live HD video consultations or in-clinic visits with real-time slot locks and transparent pricing.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
        {/* Filter Sidebar */}
        <aside className="lg:sticky lg:top-24 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2 font-display font-bold text-slate-900 dark:text-white text-sm">
              <Filter className="w-4 h-4 text-teal-600" aria-hidden="true" />
              <span>Filter Specialists</span>
            </div>
            {(selectedSpecialty !== 'All' || query || maxFeeInr < 2000) && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setDebouncedQuery('');
                  setSelectedSpecialty('All');
                  setMaxFeeInr(2000);
                }}
                className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline"
              >
                Reset
              </button>
            )}
          </div>

          {/* Specialty */}
          <div>
            <span className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
              {t.doctors.filterSpecialty}
            </span>
            <div className="space-y-1">
              {specialtiesList.map((spec) => (
                <button
                  key={spec}
                  type="button"
                  onClick={() => setSelectedSpecialty(spec)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors ${
                    selectedSpecialty === spec
                      ? 'bg-teal-50 dark:bg-teal-950/70 text-teal-700 dark:text-teal-300 font-bold border border-teal-200/70 dark:border-teal-800/70'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                  }`}
                >
                  {spec}
                </button>
              ))}
            </div>
          </div>

          {/* Sort */}
          <div>
            <label htmlFor="doctors-sort-by" className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
              Sort By
            </label>
            <select
              id="doctors-sort-by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
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
              <span className="font-mono text-teal-600 dark:text-teal-400 font-bold tabular-nums">
                ₹{maxFeeInr}
              </span>
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
            <div className="flex justify-between text-[11px] text-slate-400 mt-1 tabular-nums">
              <span>₹300</span>
              <span>₹2,000+</span>
            </div>
          </div>
        </aside>

        {/* Doctors Directory Results */}
        <div className="lg:col-span-3 space-y-5">
          <div className="relative flex items-center p-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm focus-within:ring-2 focus-within:ring-teal-500">
            <Search className="w-5 h-5 text-slate-400 ml-3 shrink-0" aria-hidden="true" />
            <input
              type="text"
              aria-label="Search doctors or symptoms"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search symptoms, doctor name, or specialty (e.g. chest pain, Subhash, Dermatology)..."
              className="w-full bg-transparent border-none px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
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
                  <div className="h-3.5 w-72 bg-slate-100 dark:bg-slate-800 rounded" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="p-8 text-center bg-rose-50 dark:bg-rose-950/30 rounded-2xl border border-rose-200 dark:border-rose-900 space-y-3">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" aria-hidden="true" />
              <p className="text-sm font-bold text-rose-700 dark:text-rose-300">
                Failed to load doctors: {(error as Error)?.message}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Retry
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
                <span>Showing {doctors.length} verified specialist{doctors.length === 1 ? '' : 's'}</span>
              </div>

              {doctors.length === 0 ? (
                <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <Sparkles className="w-10 h-10 text-slate-300 mx-auto mb-2" aria-hidden="true" />
                  <h3 className="font-display font-bold text-slate-800 dark:text-slate-200 text-base">
                    No doctors match your criteria
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                    Try clearing your symptom search, resetting the specialty filter, or raising the fee range.
                  </p>
                </div>
              ) : (
                <div ref={doctorsListRef} className="space-y-4">
                  {doctors.map((doc) => (
                    <div
                      key={doc.id}
                      data-testid="doctor-card"
                      className="clinical-card p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 hover:border-teal-500/60 hover:shadow-lg transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6"
                    >
                      <div className="flex items-start gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 text-white font-display font-bold text-lg flex items-center justify-center shrink-0 shadow-sm">
                          {doc.name.replace(/^Dr\.\s*/i, '').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-display font-bold text-lg text-slate-900 dark:text-white">
                              {doc.name}
                            </h3>
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-200/60 dark:border-emerald-800/60">
                              <CheckCircle className="w-3 h-3" aria-hidden="true" /> NMC Verified
                            </span>
                          </div>
                          <p className="text-sm text-teal-700 dark:text-teal-400 font-semibold">
                            {doc.specialty} • {doc.experienceYears} Years Experience
                            {doc.qualifications ? ` • ${doc.qualifications}` : ''}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                            <span>
                              {doc.clinicName || 'MediBook Clinic'}
                              {doc.clinicAddress ? ` • ${doc.clinicAddress}` : ''}
                            </span>
                          </p>
                          <div className="flex flex-wrap items-center gap-3 text-xs pt-1">
                            <span className="flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400">
                              <Star className="w-3.5 h-3.5 fill-current" aria-hidden="true" />{' '}
                              {doc.reviewCount > 0 ? doc.averageRating.toFixed(1) : 'New'}
                              <span className="text-slate-400 font-normal">({doc.reviewCount})</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-full text-[11px] font-medium text-slate-600 dark:text-slate-300">
                              <Video className="w-3 h-3 text-teal-600 dark:text-teal-400" aria-hidden="true" /> Video &amp; Clinic
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="w-full sm:w-auto flex sm:flex-col items-center sm:items-end justify-between gap-3 pt-4 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800 shrink-0">
                        <div className="sm:text-right">
                          <span className="text-[11px] text-slate-400 block uppercase tracking-wider font-semibold">
                            {t.doctors.fee}
                          </span>
                          <span className="font-display text-xl font-extrabold text-slate-900 dark:text-white tabular-nums">
                            {formatPaise(doc.consultationFeePaise)}
                          </span>
                        </div>

                        <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>
                            {doc.nextAvailableSlot
                              ? formatIstDateTime(doc.nextAvailableSlot)
                              : 'Check schedule'}
                          </span>
                        </div>

                        <Link
                          href={`/doctors/${doc.id}`}
                          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs sm:text-sm shadow-sm transition-colors"
                        >
                          <span>{t.doctors.bookSlot}</span>
                          <ChevronRight className="w-4 h-4" aria-hidden="true" />
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
    <Suspense fallback={<div className="p-12 text-center text-sm text-slate-500">Loading verified doctors...</div>}>
      <DoctorsListContent />
    </Suspense>
  );
}
