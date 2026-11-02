'use client';

import React, { useState } from 'react';
import {
  CheckCircle,
  RotateCcw,
} from 'lucide-react';
import { formatPaise } from '@/lib/utils';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'verification' | 'ledger' | 'audit'>('verification');

  // Doctor Verification Queue
  const [pendingDoctors, setPendingDoctors] = useState([
    {
      id: 'doc-verify-1',
      name: 'Dr. Tanmoy Chakraborty',
      degrees: 'MBBS, MS (ENT)',
      regNumber: 'WBMC/88912',
      council: 'West Bengal Medical Council',
      submittedAt: 'Today, 02:15 PM',
      experienceYears: 8,
    },
    {
      id: 'doc-verify-2',
      name: 'Dr. Ananya Roy',
      degrees: 'MBBS, MD (Psychiatry)',
      regNumber: 'MCI/55120',
      council: 'Medical Council of India',
      submittedAt: 'Yesterday, 05:40 PM',
      experienceYears: 12,
    },
  ]);

  // Double-Entry Ledger Transactions
  const ledgerEntries = [
    {
      id: 'tx-1001',
      reference: 'MB-20261102-042',
      description: 'Appointment Capture Fee & Commission',
      patientDebitPaise: 100300,
      doctorCreditPaise: 80000,
      platformCreditPaise: 5000,
      taxCreditPaise: 15300,
      status: 'BALANCED',
    },
    {
      id: 'tx-1002',
      reference: 'MB-20261028-011',
      description: 'Patient Cancellation Refund (>24h notice)',
      patientDebitPaise: 0,
      doctorCreditPaise: 0,
      platformCreditPaise: 0,
      taxCreditPaise: 0,
      status: 'REFUNDED_ZERO_SUM',
    },
  ];

  // Audit Logs
  const auditLogs = [
    {
      id: 'aud-1',
      action: 'PHI_RECORD_READ',
      actor: 'Dr. Arindam Mukherjee (DOCTOR)',
      resource: 'Prescription: rx-apt-101',
      patientId: 'usr-patient-1',
      timestamp: '2026-11-02 17:35:10',
      ip: '103.21.124.8',
    },
    {
      id: 'aud-2',
      action: 'PAYMENT_CAPTURED',
      actor: 'Razorpay Webhook Worker',
      resource: 'Payment: pay-99812',
      patientId: 'usr-patient-1',
      timestamp: '2026-11-02 17:30:00',
      ip: '52.66.192.4',
    },
    {
      id: 'aud-3',
      action: 'DOCTOR_VERIFIED',
      actor: 'Admin User (ADMIN)',
      resource: 'Doctor: doc-1',
      patientId: '-',
      timestamp: '2026-11-01 10:14:22',
      ip: '127.0.0.1',
    },
  ];

  const handleApproveDoctor = (id: string) => {
    setPendingDoctors((prev) => prev.filter((d) => d.id !== id));
    alert('Doctor approved and verified. Profile is now publicly bookable in directory.');
  };

  const handleRejectDoctor = (id: string) => {
    setPendingDoctors((prev) => prev.filter((d) => d.id !== id));
    alert('Doctor application rejected. Audit entry recorded.');
  };

  const handleTriggerReconciliation = () => {
    alert('Reconciliation job executed: 0 stuck webhooks found, all ledger entries balance to zero-sum.');
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">Admin Operations Portal</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Doctor verification audit, double-entry financial ledger integrity, and immutable compliance logs
          </p>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
          <button
            onClick={() => setActiveTab('verification')}
            className={`px-3.5 py-2 rounded-lg transition-colors ${activeTab === 'verification' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            Doctor Verification ({pendingDoctors.length})
          </button>
          <button
            onClick={() => setActiveTab('ledger')}
            className={`px-3.5 py-2 rounded-lg transition-colors ${activeTab === 'ledger' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            Double-Entry Ledger
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-3.5 py-2 rounded-lg transition-colors ${activeTab === 'audit' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            Audit Trail (PHI Reads)
          </button>
        </div>
      </div>

      {/* Verification Queue */}
      {activeTab === 'verification' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Pending Doctor Verification Applications</h2>
            <span className="text-xs text-slate-400">Strict NMC registration check required</span>
          </div>

          {pendingDoctors.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
              <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <h3 className="font-bold text-sm text-slate-700 dark:text-slate-300">All doctors verified!</h3>
              <p className="text-xs text-slate-400 mt-1">No pending verification requests in the queue.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingDoctors.map((doc) => (
                <div
                  key={doc.id}
                  className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-base text-slate-900 dark:text-white">{doc.name}</h3>
                      <span className="text-xs font-mono font-semibold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-700 dark:text-slate-300">
                        {doc.regNumber}
                      </span>
                    </div>
                    <p className="text-xs text-teal-600 font-semibold">{doc.degrees}</p>
                    <p className="text-xs text-slate-500">
                      Council: {doc.council} • Experience: {doc.experienceYears} Years • Submitted: {doc.submittedAt}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-2 sm:pt-0">
                    <button
                      onClick={() => handleRejectDoctor(doc.id)}
                      className="px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 text-xs font-semibold transition-colors"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => handleApproveDoctor(doc.id)}
                      className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-sm transition-colors flex items-center gap-1.5"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      Approve & Verify
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ledger Explorer */}
      {activeTab === 'ledger' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Double-Entry Ledger Integrity</h2>
              <p className="text-xs text-slate-400">
                Invariant: <span className="font-mono text-emerald-600">Debits === Credits</span> in integer paise
              </p>
            </div>
            <button
              onClick={handleTriggerReconciliation}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 text-teal-600" /> Run Reconciliation Job
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-800 dark:text-slate-200">
                <tr>
                  <th className="p-3.5">Reference</th>
                  <th className="p-3.5">Description</th>
                  <th className="p-3.5">Patient Debit</th>
                  <th className="p-3.5">Doctor Credit</th>
                  <th className="p-3.5">Platform Fee</th>
                  <th className="p-3.5">GST</th>
                  <th className="p-3.5">Invariant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ledgerEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="p-3.5 font-mono font-semibold text-teal-600">{entry.reference}</td>
                    <td className="p-3.5">{entry.description}</td>
                    <td className="p-3.5 font-semibold text-slate-900 dark:text-white">
                      {formatPaise(entry.patientDebitPaise)}
                    </td>
                    <td className="p-3.5 text-emerald-600 font-medium">{formatPaise(entry.doctorCreditPaise)}</td>
                    <td className="p-3.5 text-slate-600">{formatPaise(entry.platformCreditPaise)}</td>
                    <td className="p-3.5 text-slate-600">{formatPaise(entry.taxCreditPaise)}</td>
                    <td className="p-3.5">
                      <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 rounded">
                        ✓ Balanced
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Audit Trail */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Immutable Security & PHI Read Audit Trail</h2>
              <p className="text-xs text-slate-400">All data mutations and medical record reads are logged</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-800 dark:text-slate-200">
                <tr>
                  <th className="p-3.5">Timestamp</th>
                  <th className="p-3.5">Action</th>
                  <th className="p-3.5">Actor</th>
                  <th className="p-3.5">Resource</th>
                  <th className="p-3.5">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 font-mono text-[11px]">
                    <td className="p-3.5 text-slate-400">{log.timestamp}</td>
                    <td className="p-3.5">
                      <span className="font-bold text-teal-600">{log.action}</span>
                    </td>
                    <td className="p-3.5 text-slate-800 dark:text-slate-200">{log.actor}</td>
                    <td className="p-3.5">{log.resource}</td>
                    <td className="p-3.5 text-slate-400">{log.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
