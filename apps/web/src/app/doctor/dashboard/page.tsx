'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Video,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';

const earningsData = [
  { day: 'Mon', earnings: 6400 },
  { day: 'Tue', earnings: 8800 },
  { day: 'Wed', earnings: 7200 },
  { day: 'Thu', earnings: 9600 },
  { day: 'Fri', earnings: 11200 },
  { day: 'Sat', earnings: 14400 },
  { day: 'Sun', earnings: 4800 },
];

export default function DoctorDashboardPage() {
  const [activeTab, setActiveTab] = useState<'queue' | 'availability' | 'earnings'>('queue');
  const [leaves, setLeaves] = useState([
    { id: 'l-1', startDate: '2026-11-12', endDate: '2026-11-14', reason: 'Annual Medical Conference' },
  ]);
  const [newLeaveStart, setNewLeaveStart] = useState('');
  const [newLeaveEnd, setNewLeaveEnd] = useState('');
  const [newLeaveReason, setNewLeaveReason] = useState('');
  const [dryRunImpact, setDryRunImpact] = useState<number | null>(null);

  const todayQueue = [
    {
      id: 'apt-101',
      patientName: 'Aniket Chaudhary',
      age: 28,
      slot: '05:30 PM',
      type: 'Video Consultation',
      status: 'CONFIRMED',
      chiefComplaint: 'Mild chest heaviness post-prandial',
    },
    {
      id: 'apt-102',
      patientName: 'Sneha Mukherjee',
      age: 34,
      slot: '06:00 PM',
      type: 'Video Consultation',
      status: 'WAITING',
      chiefComplaint: 'Routine follow-up on Telmisartan dosage',
    },
    {
      id: 'apt-103',
      patientName: 'Prabir Ganguly',
      age: 52,
      slot: '06:30 PM',
      type: 'Video Consultation',
      status: 'CONFIRMED',
      chiefComplaint: 'ECG review and palpitations',
    },
  ];

  const handleDryRunLeave = () => {
    if (!newLeaveStart || !newLeaveEnd) return;
    // Simulate dry run calculation
    setDryRunImpact(4); // 4 booked appointments would be affected
  };

  const handleApplyLeave = () => {
    if (!newLeaveStart || !newLeaveEnd) return;
    setLeaves((prev) => [
      ...prev,
      {
        id: `l-${Date.now()}`,
        startDate: newLeaveStart,
        endDate: newLeaveEnd,
        reason: newLeaveReason || 'Personal Leave',
      },
    ]);
    alert(
      `Leave scheduled! Cascaded cancellation initiated for ${dryRunImpact || 0} appointments with 100% automated refund and notification dispatch via outbox.`
    );
    setNewLeaveStart('');
    setNewLeaveEnd('');
    setNewLeaveReason('');
    setDryRunImpact(null);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              Doctor Clinical Workspace
            </h1>
            <span className="text-xs font-bold text-teal-600 bg-teal-50 dark:bg-teal-950 px-2.5 py-0.5 rounded-full">
              Dr. Arindam Mukherjee
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Department of Cardiology • NMC Registered (WBMC/64921)
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

      {/* Queue Tab */}
      {activeTab === 'queue' && (
        <div className="space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Scheduled Appointments (Asia/Kolkata)</h2>
          <div className="space-y-3">
            {todayQueue.map((apt) => (
              <div
                key={apt.id}
                className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs text-teal-600">{apt.slot}</span>
                    <span className="text-slate-400">•</span>
                    <h3 className="font-bold text-base text-slate-900 dark:text-white">
                      {apt.patientName} ({apt.age}y)
                    </h3>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        apt.status === 'WAITING'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      }`}
                    >
                      {apt.status === 'WAITING' ? 'In Waiting Room' : 'Confirmed'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">Chief Complaint: {apt.chiefComplaint}</p>
                </div>

                <Link
                  href={`/consultation/${apt.id}`}
                  className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-sm transition-colors flex items-center gap-1.5"
                >
                  <Video className="w-4 h-4" />
                  <span>Start Consultation</span>
                </Link>
              </div>
            ))}
          </div>
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
              Applying leave automatically performs a dry-run check to prevent silent orphan bookings.
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
                  placeholder="e.g. Conference, Medical Leave"
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>

              {dryRunImpact !== null && (
                <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" /> Dry-Run Conflict Evaluation:
                  </div>
                  <p>
                    <span className="font-bold">{dryRunImpact} active appointments</span> fall inside this date window. If confirmed, they will be automatically cancelled, 100% refunded, and patients notified.
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleDryRunLeave}
                  className="flex-1 py-2.5 px-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-xs transition-colors"
                >
                  Dry-Run Impact Check
                </button>
                <button
                  type="button"
                  onClick={handleApplyLeave}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm transition-colors"
                >
                  Confirm & Cascade Leave
                </button>
              </div>
            </div>
          </div>

          {/* Active Leaves List */}
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Active Approved Leaves</h3>
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
                  <button
                    onClick={() => setLeaves((prev) => prev.filter((item) => item.id !== l.id))}
                    className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
                    title="Remove leave"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
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
              <span className="text-xl font-extrabold text-teal-600">₹62,400</span>
            </div>

            <div className="h-60 pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={earningsData}>
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
            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200">Rohit S.</span>
                  <span className="flex text-amber-500 font-bold">5.0 ★</span>
                </div>
                <p className="text-slate-500">
                  Very thorough explanation of cardiac symptoms and BP management. Digital prescription was available immediately.
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200">Kavita B.</span>
                  <span className="flex text-amber-500 font-bold">5.0 ★</span>
                </div>
                <p className="text-slate-500">
                  Video quality was clear and doctor joined exactly on time. Excellent clinical care.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
