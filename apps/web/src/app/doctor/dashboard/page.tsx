'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Calendar,
  Video,
  AlertTriangle,
  Clock,
  CheckCircle,
  Loader2,
  DollarSign,
  Star,
  Users,
  ShieldAlert,
  ShieldCheck,
  Save,
  Briefcase,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { fetchApi } from '@/lib/api';
import { formatPaise } from '@/lib/utils';

interface DoctorDashboardData {
  doctorId: string;
  doctorName: string;
  specialty: string;
  isVerified: boolean;
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  licenseNumber: string | null;
  photoUrl: string | null;
  stats: {
    totalEarningsPaise: number;
    totalConsultations: number;
    todayQueueCount: number;
    upcomingCount: number;
    cancelledCount: number;
  };
  earningsChart: Array<{ day: string; earnings: number }>;
  todayQueue: Array<{
    id: string;
    bookingRef: string | null;
    patientName: string;
    patientPhone?: string;
    slotTime: string;
    consultationMode: string;
    status: string;
    chiefComplaint: string;
    sessionStatus: string;
  }>;
  leaves: Array<{
    id: string;
    startDate: string;
    endDate: string;
    reason: string;
  }>;
  reviews: Array<{
    id: string;
    rating: number;
    comment: string | null;
    patientName: string;
    createdAt: string;
  }>;
}

interface DoctorProfileData {
  id: string;
  name: string;
  email: string;
  specialty: string;
  qualifications: string | null;
  experienceYears: number;
  clinicName: string | null;
  clinicAddress: string | null;
  consultationFeePaise: number;
  licenseNumber: string | null;
  isVerified: boolean;
  verificationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  availability: Array<{
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    slotDurationMinutes: number;
  }>;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function DoctorDashboardPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'queue' | 'availability' | 'earnings'>('queue');

  const [newLeaveStart, setNewLeaveStart] = useState('');
  const [newLeaveEnd, setNewLeaveEnd] = useState('');
  const [newLeaveReason, setNewLeaveReason] = useState('');
  const [dryRunImpact, setDryRunImpact] = useState<number | null>(null);

  // Profile Form States
  const [licenseInput, setLicenseInput] = useState('');
  const [specialtyInput, setSpecialtyInput] = useState('');
  const [qualificationsInput, setQualificationsInput] = useState('');
  const [experienceInput, setExperienceInput] = useState(5);
  const [feeRupeesInput, setFeeRupeesInput] = useState(500);

  // Schedule Editor States
  const [weeklySchedule, setWeeklySchedule] = useState<
    Array<{ dayOfWeek: number; enabled: boolean; startTime: string; endTime: string; slotDurationMinutes: number }>
  >(
    DAYS.map((_, i) => ({
      dayOfWeek: i,
      enabled: i >= 1 && i <= 5, // Mon-Fri default
      startTime: '09:00',
      endTime: '17:00',
      slotDurationMinutes: 15,
    }))
  );

  const { data, isLoading, error } = useQuery<DoctorDashboardData>({
    queryKey: ['doctor-dashboard'],
    queryFn: () => fetchApi('/doctors/me/dashboard'),
  });

  const { data: profile } = useQuery<DoctorProfileData>({
    queryKey: ['doctor-profile'],
    queryFn: () => fetchApi('/doctors/me/profile'),
  });

  useEffect(() => {
    if (profile) {
      setLicenseInput(profile.licenseNumber || '');
      setSpecialtyInput(profile.specialty || 'General Medicine');
      setQualificationsInput(profile.qualifications || '');
      setExperienceInput(profile.experienceYears || 5);
      setFeeRupeesInput(Math.round((profile.consultationFeePaise || 50000) / 100));

      if (profile.availability && profile.availability.length > 0) {
        setWeeklySchedule((prev) =>
          prev.map((day) => {
            const matched = profile.availability.find((a) => a.dayOfWeek === day.dayOfWeek);
            if (matched) {
              return {
                dayOfWeek: day.dayOfWeek,
                enabled: true,
                startTime: matched.startTime.slice(0, 5),
                endTime: matched.endTime.slice(0, 5),
                slotDurationMinutes: matched.slotDurationMinutes || 15,
              };
            }
            return { ...day, enabled: false };
          })
        );
      }
    }
  }, [profile]);

  const previewMutation = useMutation({
    mutationFn: (body: { startDate: string; endDate: string }) => {
      if (!data?.doctorId) throw new Error('Doctor profile not loaded');
      return fetchApi<{ conflictCount: number }>(`/doctors/${data.doctorId}/leaves/preview`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: (res) => {
      setDryRunImpact(res.conflictCount ?? 0);
    },
    onError: (err: any) => {
      alert(`Dry run failed: ${err.message || 'Validation error'}`);
    },
  });

  const applyLeaveMutation = useMutation({
    mutationFn: (body: { startDate: string; endDate: string; reason: string }) => {
      if (!data?.doctorId) throw new Error('Doctor profile not loaded');
      return fetchApi(`/doctors/${data.doctorId}/leaves`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['doctor-dashboard'] });
      alert(
        `Leave scheduled successfully. ${res?.cancelledAppointmentsCount ?? 0} conflicting appointments were automatically cancelled and 100% refunded to patients.`
      );
      setNewLeaveStart('');
      setNewLeaveEnd('');
      setNewLeaveReason('');
      setDryRunImpact(null);
    },
    onError: (err: any) => {
      alert(`Failed to apply leave: ${err.message || 'Operation failed'}`);
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: (body: any) =>
      fetchApi('/doctors/me/profile', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doctor-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['doctor-profile'] });
      alert('Doctor license and professional profile successfully saved.');
    },
    onError: (err: any) => {
      alert(`Failed to update profile: ${err.message || 'Validation error'}`);
    },
  });

  const updateScheduleMutation = useMutation({
    mutationFn: (slots: any[]) =>
      fetchApi('/doctors/me/availability', {
        method: 'PUT',
        body: JSON.stringify({ slots }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doctor-profile'] });
      alert('Weekly schedule and recurring working hours saved.');
    },
    onError: (err: any) => {
      alert(`Failed to save availability schedule: ${err.message || 'Validation error'}`);
    },
  });

  const handleDryRunLeave = () => {
    if (!newLeaveStart || !newLeaveEnd) {
      alert('Please select both start and end dates');
      return;
    }
    previewMutation.mutate({ startDate: newLeaveStart, endDate: newLeaveEnd });
  };

  const handleApplyLeave = () => {
    if (!newLeaveStart || !newLeaveEnd) {
      alert('Please select both start and end dates');
      return;
    }
    applyLeaveMutation.mutate({
      startDate: newLeaveStart,
      endDate: newLeaveEnd,
      reason: newLeaveReason || 'Personal Leave',
    });
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfileMutation.mutate({
      licenseNumber: licenseInput,
      specialty: specialtyInput,
      qualifications: qualificationsInput,
      experienceYears: Number(experienceInput),
      consultationFeePaise: Math.round(Number(feeRupeesInput) * 100),
    });
  };

  const handleSaveSchedule = () => {
    const activeSlots = weeklySchedule
      .filter((s) => s.enabled)
      .map((s) => ({
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        slotDurationMinutes: s.slotDurationMinutes,
      }));
    updateScheduleMutation.mutate(activeSlots);
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-24 text-center">
        <Loader2 className="w-10 h-10 animate-spin text-teal-600 mx-auto" />
        <p className="text-xs text-slate-500 mt-3">Loading clinical dashboard...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-24 text-center">
        <AlertTriangle className="w-10 h-10 text-rose-500 mx-auto" />
        <h2 className="text-lg font-bold text-slate-800 dark:text-white mt-2">Doctor Profile Not Found</h2>
        <p className="text-xs text-slate-500 mt-1">Please ensure you are logged in with an active Doctor account.</p>
      </div>
    );
  }

  const { stats, todayQueue, earningsChart, reviews } = data;
  const isPending = data.verificationStatus === 'PENDING';
  const isRejected = data.verificationStatus === 'REJECTED';

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Verification Status Banner */}
      {isPending && (
        <div className="p-4 sm:p-5 rounded-3xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900 flex items-start gap-3.5">
          <ShieldAlert className="w-6 h-6 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
              Medical Practitioner Verification Pending
            </h3>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Your medical registration (<span className="font-mono font-semibold">{data.licenseNumber || 'License Under Review'}</span>) is currently being audited by administrators. You can update your practice information and configure your weekly schedule below; your public booking profile will become active upon approval.
            </p>
          </div>
        </div>
      )}

      {isRejected && (
        <div className="p-4 sm:p-5 rounded-3xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 flex items-start gap-3.5">
          <AlertTriangle className="w-6 h-6 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200">
              Verification Needs Revision
            </h3>
            <p className="text-xs text-rose-800 dark:text-rose-300">
              Your medical license verification was rejected. Please review and update your license details or qualifications below to re-submit for review.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              {data.doctorName}
            </h1>
            {data.isVerified ? (
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> NMC Verified
              </span>
            ) : (
              <span className="text-xs font-bold text-amber-700 bg-amber-50 dark:bg-amber-950 px-2.5 py-0.5 rounded-full">
                Verification Pending
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Specialty: {data.specialty} • Real-time clinical queue & automated scheduling
          </p>
        </div>

        {/* Workspace Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
          <button
            onClick={() => setActiveTab('queue')}
            className={`px-3.5 py-2 rounded-lg transition-colors ${activeTab === 'queue' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            Today&apos;s Queue ({todayQueue.length})
          </button>
          <button
            onClick={() => setActiveTab('availability')}
            className={`px-3.5 py-2 rounded-lg transition-colors ${activeTab === 'availability' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            Leaves & Schedule
          </button>
          <button
            onClick={() => setActiveTab('earnings')}
            className={`px-3.5 py-2 rounded-lg transition-colors ${activeTab === 'earnings' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            Earnings & Reviews
          </button>
        </div>
      </div>

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-xs text-slate-400 flex items-center gap-1.5 font-medium">
            <Clock className="w-3.5 h-3.5 text-teal-600" /> Today&apos;s Patients
          </span>
          <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">{stats.todayQueueCount}</p>
        </div>
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-xs text-slate-400 flex items-center gap-1.5 font-medium">
            <Users className="w-3.5 h-3.5 text-blue-600" /> Upcoming
          </span>
          <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">{stats.upcomingCount}</p>
        </div>
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-xs text-slate-400 flex items-center gap-1.5 font-medium">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-600" /> Completed
          </span>
          <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">{stats.totalConsultations}</p>
        </div>
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-xs text-slate-400 flex items-center gap-1.5 font-medium">
            <DollarSign className="w-3.5 h-3.5 text-purple-600" /> Total Earnings
          </span>
          <p className="text-xl font-bold text-emerald-600 mt-1">{formatPaise(stats.totalEarningsPaise)}</p>
        </div>
      </div>

      {/* Queue Tab */}
      {activeTab === 'queue' && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Scheduled Appointments (Asia/Kolkata)</h2>
          {todayQueue.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
              <CheckCircle className="w-10 h-10 text-teal-600 mx-auto mb-2" />
              <h3 className="font-bold text-sm text-slate-700 dark:text-slate-300">No more patients for today</h3>
              <p className="text-xs text-slate-400 mt-1">All scheduled consultation slots for today are clear.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todayQueue.map((apt) => (
                <div
                  key={apt.id}
                  className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs text-teal-600">
                        {new Date(apt.slotTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-slate-400">•</span>
                      <h3 className="font-bold text-base text-slate-900 dark:text-white">
                        {apt.patientName}
                      </h3>
                      {apt.bookingRef && (
                        <span className="text-xs font-mono text-slate-400">({apt.bookingRef})</span>
                      )}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          apt.status === 'IN_PROGRESS'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                      >
                        {apt.status === 'IN_PROGRESS' ? 'In Progress' : apt.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      Chief Complaint: {apt.chiefComplaint} • Mode: {apt.consultationMode}
                    </p>
                  </div>

                  <Link
                    href={`/consultation/${apt.id}`}
                    className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-sm transition-colors flex items-center gap-1.5"
                  >
                    <Video className="w-4 h-4" />
                    <span>Enter Consultation Room</span>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Leaves & Schedule Tab */}
      {activeTab === 'availability' && (
        <div className="space-y-6">
          {/* Weekly Schedule Availability Editor */}
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-teal-600" /> Weekly Working Hours & Schedule Availability
                </h3>
                <p className="text-xs text-slate-500">
                  Configure your standard consultation hours per day of the week. Slots will be auto-generated in 15-minute grids.
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveSchedule}
                disabled={updateScheduleMutation.isPending}
                className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{updateScheduleMutation.isPending ? 'Saving...' : 'Save Schedule'}</span>
              </button>
            </div>

            <div className="space-y-2 pt-2">
              {weeklySchedule.map((day, idx) => (
                <div
                  key={day.dayOfWeek}
                  className={`p-3.5 rounded-2xl border transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                    day.enabled
                      ? 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                      : 'bg-slate-100/40 dark:bg-slate-900/40 border-dashed border-slate-200 dark:border-slate-800 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3 w-36">
                    <input
                      type="checkbox"
                      id={`day-${day.dayOfWeek}`}
                      checked={day.enabled}
                      onChange={(e) => {
                        const updated = [...weeklySchedule];
                        updated[idx].enabled = e.target.checked;
                        setWeeklySchedule(updated);
                      }}
                      className="rounded text-teal-600 focus:ring-teal-500 w-4 h-4"
                    />
                    <label htmlFor={`day-${day.dayOfWeek}`} className="text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer">
                      {DAYS[day.dayOfWeek]}
                    </label>
                  </div>

                  {day.enabled ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-400">Hours:</span>
                      <input
                        type="time"
                        value={day.startTime}
                        onChange={(e) => {
                          const updated = [...weeklySchedule];
                          updated[idx].startTime = e.target.value;
                          setWeeklySchedule(updated);
                        }}
                        className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200"
                      />
                      <span className="text-slate-400">to</span>
                      <input
                        type="time"
                        value={day.endTime}
                        onChange={(e) => {
                          const updated = [...weeklySchedule];
                          updated[idx].endTime = e.target.value;
                          setWeeklySchedule(updated);
                        }}
                        className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200"
                      />
                      <span className="text-slate-400 ml-2">Slot: 15 min</span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400 italic">Off duty / Unavailable</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Apply Leave Card */}
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-teal-600" /> Apply Doctor Leave
              </h3>
              <p className="text-xs text-slate-500">
                Applying leave automatically performs a dry-run check to prevent silent orphan bookings and triggers automated 100% refunds.
              </p>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={newLeaveStart}
                    onChange={(e) => setNewLeaveStart(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">End Date</label>
                  <input
                    type="date"
                    value={newLeaveEnd}
                    onChange={(e) => setNewLeaveEnd(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Reason</label>
                  <input
                    type="text"
                    value={newLeaveReason}
                    onChange={(e) => setNewLeaveReason(e.target.value)}
                    placeholder="e.g. Medical Conference, Personal Leave"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  />
                </div>

                {dryRunImpact !== null && (
                  <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600" /> Dry-Run Conflict Evaluation:
                    </div>
                    <p>
                      <span className="font-bold">{dryRunImpact} booked appointments</span> fall inside this date window. If confirmed, they will be automatically cancelled, 100% refunded, and patients notified.
                    </p>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleDryRunLeave}
                    disabled={previewMutation.isPending}
                    className="flex-1 py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-xs transition-colors disabled:opacity-50"
                  >
                    {previewMutation.isPending ? 'Checking...' : 'Dry-Run Impact Check'}
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyLeave}
                    disabled={applyLeaveMutation.isPending}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm transition-colors disabled:opacity-50"
                  >
                    {applyLeaveMutation.isPending ? 'Processing...' : 'Confirm & Cascade Leave'}
                  </button>
                </div>
              </div>
            </div>

            {/* Profile & License Credentials Card */}
            <form onSubmit={handleSaveProfile} className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-teal-600" /> License & Credentials
                </h3>
                <button
                  type="submit"
                  disabled={updateProfileMutation.isPending}
                  className="px-3.5 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-xs transition-colors disabled:opacity-50"
                >
                  {updateProfileMutation.isPending ? 'Updating...' : 'Update Details'}
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Medical License / Registration No.</label>
                  <input
                    type="text"
                    required
                    value={licenseInput}
                    onChange={(e) => setLicenseInput(e.target.value)}
                    placeholder="e.g. WBMC/88219"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Specialty</label>
                  <input
                    type="text"
                    required
                    value={specialtyInput}
                    onChange={(e) => setSpecialtyInput(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Qualifications / Degrees</label>
                  <input
                    type="text"
                    value={qualificationsInput}
                    onChange={(e) => setQualificationsInput(e.target.value)}
                    placeholder="e.g. MBBS, MD (General Medicine)"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Experience (Years)</label>
                    <input
                      type="number"
                      min={0}
                      value={experienceInput}
                      onChange={(e) => setExperienceInput(Number(e.target.value))}
                      className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Fee (INR)</label>
                    <input
                      type="number"
                      min={100}
                      step={50}
                      value={feeRupeesInput}
                      onChange={(e) => setFeeRupeesInput(Number(e.target.value))}
                      className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Earnings & Reviews Tab */}
      {activeTab === 'earnings' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Weekly Consultation Revenue</h3>
                <p className="text-xs text-slate-500">Platform double-entry settlement (INR)</p>
              </div>
              <span className="text-xl font-extrabold text-teal-600">
                {formatPaise(stats.totalEarningsPaise)}
              </span>
            </div>

            <div className="h-60 pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={earningsChart}>
                  <XAxis dataKey="day" stroke="#94a3b8" fontSize={11} />
                  <YAxis stroke="#94a3b8" fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="earnings" fill="#0D9488" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Recent Verified Patient Reviews</h3>
            {reviews.length === 0 ? (
              <p className="text-xs text-slate-400">No patient reviews submitted yet.</p>
            ) : (
              <div className="space-y-3 text-xs">
                {reviews.map((r) => (
                  <div
                    key={r.id}
                    className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 dark:text-slate-200">{r.patientName}</span>
                      <span className="flex items-center gap-1 text-amber-500 font-bold">
                        <Star className="w-3.5 h-3.5 fill-amber-500" />
                        {r.rating.toFixed(1)}
                      </span>
                    </div>
                    {r.comment && <p className="text-slate-500">{r.comment}</p>}
                    <span className="text-[10px] text-slate-400 block pt-0.5">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
