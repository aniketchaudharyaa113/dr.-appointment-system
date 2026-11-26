'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, FlaskConical, HeartPulse, Thermometer, Droplets, Plus } from 'lucide-react';
import { fetchApi, formatIstTime } from '@/lib/api';

interface VitalRecord {
  id: string;
  systolicBp?: number | null;
  diastolicBp?: number | null;
  heartRate?: number | null;
  spO2?: string | number | null;
  temperatureF?: string | number | null;
  bloodGlucose?: string | number | null;
  recordedAt: string;
}

interface LabOrderRecord {
  id: string;
  testName: string;
  testCode: string;
  urgency: 'ROUTINE' | 'URGENT' | 'STAT';
  instructions?: string | null;
  status: string;
  createdAt: string;
}

export function VitalsLabsPanel({
  appointmentId,
  isDoctor,
}: {
  appointmentId: string;
  isDoctor: boolean;
}) {
  const queryClient = useQueryClient();

  const [systolicBp, setSystolicBp] = useState('120');
  const [diastolicBp, setDiastolicBp] = useState('80');
  const [heartRate, setHeartRate] = useState('74');
  const [spO2, setSpO2] = useState('98.5');
  const [temperatureF, setTemperatureF] = useState('98.6');
  const [bloodGlucose, setBloodGlucose] = useState('104');

  const [testName, setTestName] = useState('Complete Blood Count (CBC)');
  const [testCode, setTestCode] = useState('CBC-001');
  const [urgency, setUrgency] = useState<'ROUTINE' | 'URGENT' | 'STAT'>('ROUTINE');
  const [instructions, setInstructions] = useState('Morning sample preferred');

  const vitalsQuery = useQuery({
    queryKey: ['consultation-vitals', appointmentId],
    queryFn: () => fetchApi<VitalRecord[]>(`/consultations/${appointmentId}/vitals`),
  });

  const labsQuery = useQuery({
    queryKey: ['consultation-labs', appointmentId],
    queryFn: () => fetchApi<LabOrderRecord[]>(`/consultations/${appointmentId}/lab-orders`),
  });

  const recordVitalsMutation = useMutation({
    mutationFn: () =>
      fetchApi<VitalRecord>(`/consultations/${appointmentId}/vitals`, {
        method: 'POST',
        body: JSON.stringify({
          systolicBp: Number(systolicBp) || undefined,
          diastolicBp: Number(diastolicBp) || undefined,
          heartRate: Number(heartRate) || undefined,
          spO2: Number(spO2) || undefined,
          temperatureF: Number(temperatureF) || undefined,
          bloodGlucose: Number(bloodGlucose) || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultation-vitals', appointmentId] });
    },
  });

  const createLabMutation = useMutation({
    mutationFn: () =>
      fetchApi<LabOrderRecord>(`/consultations/${appointmentId}/lab-orders`, {
        method: 'POST',
        body: JSON.stringify({
          testName,
          testCode,
          urgency,
          instructions: instructions.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultation-labs', appointmentId] });
    },
  });

  const latest = vitalsQuery.data?.[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Vitals Telemetry Column */}
      <section className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-950 text-teal-600 dark:text-teal-400 flex items-center justify-center">
              <HeartPulse className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Patient Vitals Telemetry
              </h2>
              <p className="text-xs text-slate-500">Live clinical readings synced to consultation</p>
            </div>
          </div>
          {latest && (
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
              Latest: {formatIstTime(latest.recordedAt)}
            </span>
          )}
        </div>

        {/* Latest Vitals Bento */}
        {latest ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 tabular-nums">
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/60">
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <Activity className="w-3.5 h-3.5 text-rose-500" /> Blood Pressure
              </span>
              <p className="text-lg font-bold mt-1">
                {latest.systolicBp ?? '--'}/{latest.diastolicBp ?? '--'}{' '}
                <span className="text-xs font-normal text-slate-500">mmHg</span>
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/60">
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <HeartPulse className="w-3.5 h-3.5 text-teal-500" /> Heart Rate
              </span>
              <p className="text-lg font-bold mt-1">
                {latest.heartRate ?? '--'}{' '}
                <span className="text-xs font-normal text-slate-500">bpm</span>
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/60">
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <Droplets className="w-3.5 h-3.5 text-cyan-500" /> SpO₂
              </span>
              <p className="text-lg font-bold mt-1">
                {latest.spO2 ?? '--'}
                <span className="text-xs font-normal text-slate-500">%</span>
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/60">
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <Thermometer className="w-3.5 h-3.5 text-amber-500" /> Temp
              </span>
              <p className="text-lg font-bold mt-1">
                {latest.temperatureF ?? '--'}{' '}
                <span className="text-xs font-normal text-slate-500">°F</span>
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/60 col-span-2 sm:col-span-2">
              <span className="text-[11px] text-slate-500">Blood Glucose</span>
              <p className="text-lg font-bold mt-1">
                {latest.bloodGlucose ?? '--'}{' '}
                <span className="text-xs font-normal text-slate-500">mg/dL</span>
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500 py-4 text-center rounded-2xl bg-slate-50 dark:bg-slate-800/40">
            No vitals recorded for this consultation yet.
          </p>
        )}

        {/* Record Vitals Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            recordVitalsMutation.mutate();
          }}
          className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3"
        >
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
            Log New Reading
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
            <label className="space-y-1">
              <span className="text-slate-500 block">Systolic (mmHg)</span>
              <input
                type="number"
                value={systolicBp}
                onChange={(e) => setSystolicBp(e.target.value)}
                className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 block">Diastolic (mmHg)</span>
              <input
                type="number"
                value={diastolicBp}
                onChange={(e) => setDiastolicBp(e.target.value)}
                className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 block">Heart Rate (bpm)</span>
              <input
                type="number"
                value={heartRate}
                onChange={(e) => setHeartRate(e.target.value)}
                className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 block">SpO₂ (%)</span>
              <input
                type="number"
                step="0.1"
                value={spO2}
                onChange={(e) => setSpO2(e.target.value)}
                className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 block">Temp (°F)</span>
              <input
                type="number"
                step="0.1"
                value={temperatureF}
                onChange={(e) => setTemperatureF(e.target.value)}
                className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </label>
            <label className="space-y-1">
              <span className="text-slate-500 block">Glucose (mg/dL)</span>
              <input
                type="number"
                step="0.5"
                value={bloodGlucose}
                onChange={(e) => setBloodGlucose(e.target.value)}
                className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={recordVitalsMutation.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold shadow-sm"
          >
            <Plus className="w-4 h-4" />
            {recordVitalsMutation.isPending ? 'Recording...' : 'Record Vitals'}
          </button>
        </form>
      </section>

      {/* Diagnostic Lab Orders Column */}
      <section className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-lg space-y-6">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-950 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
            <FlaskConical className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Diagnostic Lab Orders
            </h2>
            <p className="text-xs text-slate-500">Pathology &amp; diagnostic tests prescribed</p>
          </div>
        </div>

        <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
          {labsQuery.data && labsQuery.data.length > 0 ? (
            labsQuery.data.map((order) => (
              <div
                key={order.id}
                className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/70 dark:border-slate-700/60 flex items-start justify-between gap-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900 dark:text-white">
                      {order.testName}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                      {order.testCode}
                    </span>
                  </div>
                  {order.instructions && (
                    <p className="text-xs text-slate-500 mt-1">{order.instructions}</p>
                  )}
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <span
                    className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      order.urgency === 'STAT'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                        : order.urgency === 'URGENT'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
                    }`}
                  >
                    {order.urgency}
                  </span>
                  <p className="text-[10px] font-semibold text-slate-500">{order.status}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-500 py-4 text-center rounded-2xl bg-slate-50 dark:bg-slate-800/40">
              No diagnostic lab orders issued yet.
            </p>
          )}
        </div>

        {isDoctor && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createLabMutation.mutate();
            }}
            className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3 text-xs"
          >
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Order Diagnostic Test
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <input
                type="text"
                required
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                placeholder="Test Name"
                className="sm:col-span-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
              <input
                type="text"
                required
                value={testCode}
                onChange={(e) => setTestCode(e.target.value)}
                placeholder="Code"
                className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <select
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as 'ROUTINE' | 'URGENT' | 'STAT')}
                className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              >
                <option value="ROUTINE">ROUTINE</option>
                <option value="URGENT">URGENT</option>
                <option value="STAT">STAT</option>
              </select>
              <input
                type="text"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Patient instructions"
                className="sm:col-span-2 p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>
            <button
              type="submit"
              disabled={createLabMutation.isPending}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-bold shadow-sm"
            >
              <Plus className="w-4 h-4" />
              {createLabMutation.isPending ? 'Ordering...' : 'Issue Lab Order'}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
