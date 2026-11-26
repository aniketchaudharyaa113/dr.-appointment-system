'use client';

import React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  HeartPulse,
  FlaskConical,
  FileText,
  Printer,
  ShieldCheck,
  AlertCircle,
  Activity,
} from 'lucide-react';
import { fetchApi, formatIstTime, getCurrentUser } from '@/lib/api';

interface HealthPassportResponse {
  patient: { id: string; name: string; email: string; phone?: string | null } | null;
  latestVitals: {
    systolicBp?: number | null;
    diastolicBp?: number | null;
    heartRate?: number | null;
    spO2?: string | number | null;
    temperatureF?: string | number | null;
    bloodGlucose?: string | number | null;
    recordedAt: string;
  } | null;
  labOrders: Array<{
    id: string;
    testName: string;
    testCode: string;
    urgency: string;
    status: string;
    instructions?: string | null;
    doctorName: string;
    createdAt: string;
  }>;
  prescriptions: Array<{
    id: string;
    appointmentId: string;
    diagnosis: string;
    medicines: Array<{ name: string; dosage: string; frequency: string; durationDays: number }>;
    advice?: string | null;
    currentVersion: number;
    doctorName: string;
    createdAt: string;
  }>;
}

export default function HealthPassportPage() {
  const currentUser = typeof window !== 'undefined' ? getCurrentUser() : null;

  const passportQuery = useQuery({
    queryKey: ['patient-health-passport'],
    enabled: Boolean(currentUser?.token),
    queryFn: () => fetchApi<HealthPassportResponse>('/patients/health-passport'),
  });

  if (!currentUser?.token) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-teal-600 mx-auto" />
        <h1 className="text-xl font-bold">Sign In to View Your Health Passport</h1>
        <p className="text-sm text-slate-500">
          Access your longitudinal vitals telemetry, diagnostic lab orders, and immutable digital prescriptions.
        </p>
        <Link
          href="/auth/login?redirect=/passport"
          className="inline-block px-5 py-2.5 rounded-xl bg-teal-600 text-white text-xs font-bold"
        >
          Sign In
        </Link>
      </div>
    );
  }

  const data = passportQuery.data;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-600 dark:text-teal-400 mb-1">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            <span>ABDM-Ready Longitudinal Record</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
            Patient Health Passport
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {data?.patient ? `${data.patient.name} • ${data.patient.email}` : 'Loading patient profile...'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-bold shadow-sm hover:bg-slate-800 print:hidden"
        >
          <Printer className="w-4 h-4" aria-hidden="true" />
          <span>Print Clinical Summary</span>
        </button>
      </div>

      {passportQuery.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse" />
          ))}
        </div>
      ) : passportQuery.isError ? (
        <div className="p-6 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-sm text-rose-700 dark:text-rose-300">
          Failed to load Health Passport: {(passportQuery.error as Error)?.message}
        </div>
      ) : (
        <>
          {/* Latest Vitals */}
          <section className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <HeartPulse className="w-5 h-5 text-teal-600" aria-hidden="true" />
                Latest Recorded Vitals
              </h2>
              {data?.latestVitals && (
                <span className="text-xs text-slate-500">
                  Recorded {formatIstTime(data.latestVitals.recordedAt)}
                </span>
              )}
            </div>
            {data?.latestVitals ? (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 tabular-nums">
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                  <span className="text-[11px] text-slate-500 flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5 text-rose-500" aria-hidden="true" /> BP
                  </span>
                  <p className="text-lg font-bold mt-1">
                    {data.latestVitals.systolicBp ?? '--'}/{data.latestVitals.diastolicBp ?? '--'}
                  </p>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                  <span className="text-[11px] text-slate-500">Heart Rate</span>
                  <p className="text-lg font-bold mt-1">{data.latestVitals.heartRate ?? '--'} bpm</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                  <span className="text-[11px] text-slate-500">SpO₂</span>
                  <p className="text-lg font-bold mt-1">{data.latestVitals.spO2 ?? '--'}%</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                  <span className="text-[11px] text-slate-500">Temperature</span>
                  <p className="text-lg font-bold mt-1">{data.latestVitals.temperatureF ?? '--'} °F</p>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
                  <span className="text-[11px] text-slate-500">Blood Glucose</span>
                  <p className="text-lg font-bold mt-1">{data.latestVitals.bloodGlucose ?? '--'} mg/dL</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">No vitals recorded yet. Log vitals inside any consultation room.</p>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Diagnostic Lab Orders */}
            <section className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-cyan-600" aria-hidden="true" />
                Diagnostic Lab Orders ({data?.labOrders.length ?? 0})
              </h2>
              {data?.labOrders && data.labOrders.length > 0 ? (
                <div className="space-y-3">
                  {data.labOrders.map((o) => (
                    <div key={o.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 flex justify-between gap-3">
                      <div>
                        <p className="font-bold text-sm">
                          {o.testName} <span className="text-xs font-mono text-slate-500">({o.testCode})</span>
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">Ordered by {o.doctorName}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
                          {o.status}
                        </span>
                        <p className="text-[10px] text-slate-500 mt-1">{o.urgency}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No diagnostic lab orders recorded.</p>
              )}
            </section>

            {/* Digital Prescriptions */}
            <section className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <FileText className="w-5 h-5 text-teal-600" aria-hidden="true" />
                Immutable Digital Prescriptions ({data?.prescriptions.length ?? 0})
              </h2>
              {data?.prescriptions && data.prescriptions.length > 0 ? (
                <div className="space-y-3">
                  {data.prescriptions.map((rx) => (
                    <div key={rx.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="font-bold text-sm">{rx.diagnosis}</p>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                          v{rx.currentVersion}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">Issued by {rx.doctorName}</p>
                      <Link
                        href={`/consultation/${rx.appointmentId}?tab=prescription`}
                        className="inline-block text-xs font-semibold text-teal-600 hover:underline pt-1"
                      >
                        View full prescription &rarr;
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">No digital prescriptions issued yet.</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
