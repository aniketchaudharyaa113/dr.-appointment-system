'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { fetchApi, formatIstDateTime } from '@/lib/api';
import { formatPaise } from '@/lib/utils';
import {
  CheckCircle2,
  Calendar,
  Video,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';

interface ConfirmedAppointment {
  id: string;
  bookingRef: string;
  doctorName: string;
  specialty: string;
  slotTime: string;
  consultationMode: string;
  status: string;
  consultationFeePaise: number;
  payment: {
    id: string;
    status: string;
    amountPaise: number;
  } | null;
}

export default function BookingConfirmedPage() {
  const params = useParams();
  const appointmentId = params?.id as string;

  const { data: appt, isLoading, isError } = useQuery<ConfirmedAppointment>({
    queryKey: ['appointment', appointmentId],
    queryFn: () => fetchApi<ConfirmedAppointment>(`/appointments/${appointmentId}`),
    enabled: !!appointmentId,
  });

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center text-sm text-slate-500">
        Verifying confirmed booking...
      </div>
    );
  }

  if (isError || !appt) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-3">
        <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <p className="text-sm font-bold text-rose-600">Unable to load booking confirmation</p>
        <Link href="/appointments" className="text-xs font-semibold text-teal-600 underline">
          Go to My Appointments
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
      <div className="p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto shadow-sm">
          <CheckCircle2 className="w-10 h-10" />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-3 py-1 rounded-full">
            Payment Verified & Appointment Confirmed
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
            You&apos;re All Set for Consultation!
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Your slot has been successfully confirmed. A receipt and consultation instructions have been issued.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 max-w-lg mx-auto text-left space-y-3">
          <div className="flex justify-between items-center pb-3 border-b border-slate-200/60 dark:border-slate-700/60">
            <span className="text-xs text-slate-400">Booking Reference</span>
            <span className="font-mono font-bold text-sm text-teal-600 dark:text-teal-400">
              {appt.bookingRef || appt.id}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-slate-400 block mb-0.5">Specialist</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{appt.doctorName}</span>
              <span className="text-[11px] text-teal-600 block">{appt.specialty}</span>
            </div>
            <div>
              <span className="text-slate-400 block mb-0.5">Scheduled Slot</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {formatIstDateTime(appt.slotTime)}
              </span>
              <span className="text-[11px] text-slate-400 block">Asia/Kolkata (IST)</span>
            </div>
            <div>
              <span className="text-slate-400 block mb-0.5">Consultation Mode</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1">
                <Video className="w-3.5 h-3.5 text-teal-600" /> {appt.consultationMode}
              </span>
            </div>
            <div>
              <span className="text-slate-400 block mb-0.5">Payment Status</span>
              <span className="font-semibold text-emerald-600 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />{' '}
                {appt.payment?.status || appt.status} (
                {formatPaise(appt.payment?.amountPaise ?? appt.consultationFeePaise)})
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            href={`/consultation/${appointmentId}`}
            className="w-full sm:w-auto px-6 py-3.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
          >
            <Video className="w-4 h-4" />
            <span>Join Consultation Room</span>
            <ArrowRight className="w-4 h-4" />
          </Link>

          <Link
            href="/appointments"
            className="w-full sm:w-auto px-5 py-3 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors flex items-center justify-center gap-2"
          >
            <Calendar className="w-4 h-4" />
            <span>My Appointments</span>
          </Link>
        </div>

        <p className="text-[11px] text-slate-400">
          The video room opens 10 minutes prior to your scheduled consultation slot.
        </p>
      </div>
    </div>
  );
}
