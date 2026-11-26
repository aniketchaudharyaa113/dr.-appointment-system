'use client';

import React, { useState } from 'react';
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
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { fetchApi } from '@/lib/api';
import { formatPaise } from '@/lib/utils';

interface DoctorDashboardData {
  doctorId: string;
  doctorName: string;
  specialty: string;
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

export default function DoctorDashboardPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'queue' | 'availability' | 'earnings'>('queue');

  const [newLeaveStart, setNewLeaveStart] = useState('');
  const [newLeaveEnd, setNewLeaveEnd] = useState('');
  const [newLeaveReason, setNewLeaveReason] = useState('');
  const [dryRunImpact, setDryRunImpact] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<DoctorDashboardData>({
    queryKey: ['doctor-dashboard'],
    queryFn: () => fetchApi('/doctors/me/dashboard'),
  });

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

  const { stats, todayQueue, earningsChart, leaves, reviews } = data;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              {data.doctorName}
            </h1>
            <span className="text-xs font-bold text-teal-600 bg-teal-50 dark:bg-teal-950 px-2.5 py-0.5 rounded-full">
              Attending Physician
            </span>
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

      {/* Availability & Leave Manager with Dry-Run */}
      {activeTab === 'availability' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                  placeholder="e.g. Conference, Personal Medical Leave"
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>

              {dryRunImpact !== null && (
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" /> Dry-Run Conflict Evaluation:
                  </div>
                  <p>
                    <span className="font-bold">{dryRunImpact} booked appointments</span> fall inside this date window. If confirmed, they will be automatically cancelled, 100% refunded, and patients notified via SMS/email.
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

          {/* Active Leaves List */}
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Active Approved Leaves</h3>
            {leaves.length === 0 ? (
              <p className="text-xs text-slate-400">No scheduled leaves on record.</p>
            ) : (
              <div className="space-y-3">
                {leaves.map((l) => (
                  <div
                    key={l.id}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-800 dark:text-slate-200 block">{l.reason}</span>
                      <span className="text-slate-400">
                        {l.startDate} to {l.endDate}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
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
