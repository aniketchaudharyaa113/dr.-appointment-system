'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Clock,
  Video,
  Building,
  FileText,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import { formatPaise } from '@/lib/utils';

interface AppointmentItem {
  id: string;
  doctorName: string;
  specialty: string;
  slotTime: string;
  mode: 'VIDEO' | 'IN_CLINIC';
  status: 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  amountPaise: number;
  prescriptionAvailable?: boolean;
}

const mockAppointments: AppointmentItem[] = [
  {
    id: 'apt-101',
    doctorName: 'Dr. Arindam Mukherjee',
    specialty: 'Cardiology',
    slotTime: 'Today at 05:30 PM',
    mode: 'VIDEO',
    status: 'CONFIRMED',
    amountPaise: 100300,
    prescriptionAvailable: false,
  },
  {
    id: 'apt-102',
    doctorName: 'Dr. Debolina Sen',
    specialty: 'Dermatology',
    slotTime: '28 Oct 2026, 04:00 PM',
    mode: 'VIDEO',
    status: 'COMPLETED',
    amountPaise: 75800,
    prescriptionAvailable: true,
  },
  {
    id: 'apt-103',
    doctorName: 'Dr. Saptarshi Banerjee',
    specialty: 'General Physician',
    slotTime: '15 Oct 2026, 11:00 AM',
    mode: 'IN_CLINIC',
    status: 'COMPLETED',
    amountPaise: 64900,
    prescriptionAvailable: true,
  },
];

export default function MyAppointmentsPage() {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [appointments, setAppointments] = useState<AppointmentItem[]>(mockAppointments);
  const [cancelModalApt, setCancelModalApt] = useState<AppointmentItem | null>(null);

  const upcomingList = appointments.filter((a) => a.status === 'CONFIRMED' || a.status === 'IN_PROGRESS');
  const pastList = appointments.filter((a) => a.status === 'COMPLETED' || a.status === 'CANCELLED');

  const handleConfirmCancel = () => {
    if (!cancelModalApt) return;
    setAppointments((prev) =>
      prev.map((a) => (a.id === cancelModalApt.id ? { ...a, status: 'CANCELLED' } : a))
    );
    setCancelModalApt(null);
    alert('Appointment cancelled. Refund of 100% has been queued to your original payment method via outbox.');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">My Appointments</h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
          Manage your scheduled telehealth consultations, digital prescriptions, and refund status
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
        <button
          onClick={() => setTab('upcoming')}
          className={`pb-3 px-4 border-b-2 transition-colors ${
            tab === 'upcoming'
              ? 'border-teal-600 text-teal-600 dark:text-teal-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Upcoming ({upcomingList.length})
        </button>
        <button
          onClick={() => setTab('past')}
          className={`pb-3 px-4 border-b-2 transition-colors ${
            tab === 'past'
              ? 'border-teal-600 text-teal-600 dark:text-teal-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Past Consultations ({pastList.length})
        </button>
      </div>

      {/* List */}
      <div className="space-y-4">
        {(tab === 'upcoming' ? upcomingList : pastList).map((apt) => (
          <div
            key={apt.id}
            className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-slate-900 dark:text-white">{apt.doctorName}</h3>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    apt.status === 'CONFIRMED'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : apt.status === 'COMPLETED'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                        : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                  }`}
                >
                  {apt.status}
                </span>
              </div>
              <p className="text-xs font-semibold text-teal-600 dark:text-teal-400">{apt.specialty}</p>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> {apt.slotTime}
                </span>
                <span className="flex items-center gap-1">
                  {apt.mode === 'VIDEO' ? (
                    <>
                      <Video className="w-3.5 h-3.5 text-teal-600" /> Video Consult
                    </>
                  ) : (
                    <>
                      <Building className="w-3.5 h-3.5" /> In-Clinic Visit
                    </>
                  )}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-3 sm:pt-0 w-full sm:w-auto border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
              {apt.status === 'CONFIRMED' && (
                <>
                  <Link
                    href={`/consultation/${apt.id}`}
                    className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-sm transition-colors flex items-center gap-1.5"
                  >
                    <Video className="w-3.5 h-3.5" />
                    Join Call
                  </Link>

                  <button
                    onClick={() => setCancelModalApt(apt)}
                    className="px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold text-xs transition-colors"
                  >
                    Cancel
                  </button>
                </>
              )}

              {apt.status === 'COMPLETED' && apt.prescriptionAvailable && (
                <Link
                  href={`/consultation/${apt.id}?tab=prescription`}
                  className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold text-xs transition-colors flex items-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5 text-teal-600" />
                  View Digital Rx (v1)
                </Link>
              )}

              {apt.status === 'CANCELLED' && (
                <span className="text-xs text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1">
                  <XCircle className="w-3.5 h-3.5" /> Refund Settled (₹1,003)
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Cancellation & Refund Preview Modal */}
      {cancelModalApt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">Cancel Appointment?</h3>
                <p className="text-xs text-slate-500">Refund Policy Evaluation</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Original Payment:</span>
                <span className="font-semibold">{formatPaise(cancelModalApt.amountPaise)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Notice Period:</span>
                <span className="font-semibold text-emerald-600">&gt; 24 Hours Notice</span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between font-bold text-sm">
                <span>Refund Amount:</span>
                <span className="text-emerald-600">100% ({formatPaise(cancelModalApt.amountPaise)})</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Upon cancellation, your held slot will be instantly released and offered to the waitlist queue. The double-entry refund ledger will be posted immediately.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setCancelModalApt(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Keep Appointment
              </button>
              <button
                onClick={handleConfirmCancel}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-colors"
              >
                Confirm Cancellation & Refund
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
