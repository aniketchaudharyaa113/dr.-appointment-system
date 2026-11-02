'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { formatPaise } from '@/lib/utils';
import {
  Search,
  Filter,
  CheckCircle,
  Star,
  Video,
  Building,
  ChevronRight,
  Clock,
  Sparkles,
} from 'lucide-react';

interface DoctorItem {
  id: string;
  name: string;
  specialty: string;
  experienceYears: number;
  consultationFeePaise: number;
  rating: number;
  reviewCount: number;
  modes: ('VIDEO' | 'IN_CLINIC')[];
  nextSlotTime: string;
  clinicAddress: string;
  hospitalAffiliation: string;
}

const mockDoctors: DoctorItem[] = [
  {
    id: 'doc-1',
    name: 'Dr. Arindam Mukherjee',
    specialty: 'Cardiology',
    experienceYears: 16,
    consultationFeePaise: 80000, // ₹800
    rating: 4.9,
    reviewCount: 184,
    modes: ['VIDEO', 'IN_CLINIC'],
    nextSlotTime: 'Today at 05:30 PM',
    clinicAddress: 'Park Street Heart Clinic, Kolkata',
    hospitalAffiliation: 'Apollo Gleneagles Hospital',
  },
  {
    id: 'doc-2',
    name: 'Dr. Debolina Sen',
    specialty: 'Dermatology',
    experienceYears: 11,
    consultationFeePaise: 60000, // ₹600
    rating: 4.8,
    reviewCount: 220,
    modes: ['VIDEO'],
    nextSlotTime: 'Today at 06:15 PM',
    clinicAddress: 'Salt Lake Skin Care Centre, Kolkata',
    hospitalAffiliation: 'AMRI Hospitals',
  },
  {
    id: 'doc-3',
    name: 'Dr. Saptarshi Banerjee',
    specialty: 'General Physician',
    experienceYears: 14,
    consultationFeePaise: 50000, // ₹500
    rating: 4.9,
    reviewCount: 312,
    modes: ['VIDEO', 'IN_CLINIC'],
    nextSlotTime: 'Tomorrow at 10:00 AM',
    clinicAddress: 'South City Medical Chambers, Kolkata',
    hospitalAffiliation: 'Fortis Healthcare',
  },
  {
    id: 'doc-4',
    name: 'Dr. Priyanka Chatterjee',
    specialty: 'Pediatrics',
    experienceYears: 9,
    consultationFeePaise: 70000, // ₹700
    rating: 4.9,
    reviewCount: 145,
    modes: ['VIDEO'],
    nextSlotTime: 'Today at 07:00 PM',
    clinicAddress: 'New Town Child Wellness Clinic, Kolkata',
    hospitalAffiliation: 'Peerless Hospital',
  },
  {
    id: 'doc-5',
    name: 'Dr. Amitav Roy',
    specialty: 'Neurology',
    experienceYears: 20,
    consultationFeePaise: 120000, // ₹1,200
    rating: 4.95,
    reviewCount: 260,
    modes: ['IN_CLINIC', 'VIDEO'],
    nextSlotTime: 'Tomorrow at 11:30 AM',
    clinicAddress: 'Rashbehari Neuroscience Centre, Kolkata',
    hospitalAffiliation: 'Calcutta Medical Research Institute',
  },
  {
    id: 'doc-6',
    name: 'Dr. Sunetra Ghosh',
    specialty: 'Orthopedics',
    experienceYears: 13,
    consultationFeePaise: 75000, // ₹750
    rating: 4.75,
    reviewCount: 98,
    modes: ['IN_CLINIC'],
    nextSlotTime: 'Day after tomorrow at 04:00 PM',
    clinicAddress: 'Ballygunge Joint & Spine Clinic, Kolkata',
    hospitalAffiliation: 'Woodlands Multispeciality Hospital',
  },
];

function DoctorsListContent() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const initialSpecialty = searchParams.get('specialty') || 'All';

  const [query, setQuery] = useState(initialQuery);
  const [selectedSpecialty, setSelectedSpecialty] = useState(initialSpecialty);
  const [selectedMode, setSelectedMode] = useState<'ALL' | 'VIDEO' | 'IN_CLINIC'>('ALL');
  const [maxFee, setMaxFee] = useState<number>(1500);

  const specialtiesList = ['All', 'General Physician', 'Cardiology', 'Dermatology', 'Neurology', 'Pediatrics', 'Orthopedics'];

  const filteredDoctors = mockDoctors.filter((doc) => {
    const matchesQuery =
      !query.trim() ||
      doc.name.toLowerCase().includes(query.toLowerCase()) ||
      doc.specialty.toLowerCase().includes(query.toLowerCase()) ||
      doc.clinicAddress.toLowerCase().includes(query.toLowerCase());

    const matchesSpecialty = selectedSpecialty === 'All' || doc.specialty === selectedSpecialty;

    const matchesMode =
      selectedMode === 'ALL' ||
      (selectedMode === 'VIDEO' && doc.modes.includes('VIDEO')) ||
      (selectedMode === 'IN_CLINIC' && doc.modes.includes('IN_CLINIC'));

    const matchesFee = doc.consultationFeePaise / 100 <= maxFee;

    return matchesQuery && matchesSpecialty && matchesMode && matchesFee;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">{t.doctors.title}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          NMC-registered medical doctors with guaranteed 10-minute slot holding and live telemedicine
        </p>
      </div>

      {/* Search & Filter Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Filter Sidebar */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6 h-fit">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <Filter className="w-4 h-4 text-teal-600" />
              Filter Results
            </h3>
            <button
              onClick={() => {
                setQuery('');
                setSelectedSpecialty('All');
                setSelectedMode('ALL');
                setMaxFee(1500);
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

          {/* Mode */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              {t.doctors.filterMode}
            </label>
            <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-medium">
              {(['ALL', 'VIDEO', 'IN_CLINIC'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setSelectedMode(mode)}
                  className={`py-1.5 rounded-lg text-center transition-colors ${
                    selectedMode === mode
                      ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-300 font-bold shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {mode === 'ALL' ? 'All' : mode === 'VIDEO' ? 'Video' : 'Clinic'}
                </button>
              ))}
            </div>
          </div>

          {/* Max Fee Slider */}
          <div>
            <div className="flex justify-between items-center text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              <span>{t.doctors.filterFee}</span>
              <span className="text-teal-600 dark:text-teal-400 font-bold">₹{maxFee}</span>
            </div>
            <input
              type="range"
              min="300"
              max="2000"
              step="100"
              value={maxFee}
              onChange={(e) => setMaxFee(Number(e.target.value))}
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
          {/* Search Bar */}
          <div className="relative flex items-center p-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <Search className="w-4 h-4 text-slate-400 ml-3" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name, specialty, or clinic location..."
              className="w-full bg-transparent border-none px-3 py-2 text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none"
            />
          </div>

          <div className="text-xs font-semibold text-slate-500">
            Showing {filteredDoctors.length} available doctors
          </div>

          {filteredDoctors.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
              <Sparkles className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <h3 className="font-bold text-slate-700 dark:text-slate-300 text-sm">No doctors match your criteria</h3>
              <p className="text-xs text-slate-400 mt-1">Try resetting the filters or widening your fee range.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredDoctors.map((doc) => (
                <div
                  key={doc.id}
                  className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-teal-500/50 hover:shadow-md transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 font-bold text-lg flex items-center justify-center shrink-0">
                      {doc.name.replace('Dr. ', '').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-base text-slate-900 dark:text-white">{doc.name}</h3>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                          <CheckCircle className="w-3 h-3" /> NMC Verified
                        </span>
                      </div>
                      <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold">
                        {doc.specialty} • {doc.experienceYears} Years Experience
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {doc.hospitalAffiliation} • {doc.clinicAddress}
                      </p>
                      <div className="flex items-center gap-4 text-xs pt-1">
                        <span className="flex items-center gap-1 font-bold text-amber-500">
                          <Star className="w-3.5 h-3.5 fill-current" /> {doc.rating}
                          <span className="text-slate-400 font-normal">({doc.reviewCount})</span>
                        </span>
                        <div className="flex items-center gap-1.5 text-slate-500">
                          {doc.modes.includes('VIDEO') && (
                            <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[11px]">
                              <Video className="w-3 h-3 text-teal-600" /> Video
                            </span>
                          )}
                          {doc.modes.includes('IN_CLINIC') && (
                            <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-[11px]">
                              <Building className="w-3 h-3 text-slate-600" /> In Clinic
                            </span>
                          )}
                        </div>
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
                      <span>{doc.nextSlotTime}</span>
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
