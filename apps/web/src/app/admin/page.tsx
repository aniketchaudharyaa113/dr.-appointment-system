'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  RotateCcw,
  Users,
  AlertTriangle,
  CreditCard,
  Video,
  ShieldCheck,
  UserCheck,
  Loader2,
} from 'lucide-react';
import { fetchApi } from '@/lib/api';
import { formatPaise } from '@/lib/utils';
import { RoleGuard } from '@/components/role-guard';

interface AdminStats {
  pendingDoctorsCount: number;
  stuckPaymentsCount: number;
  totalPlatformRevenuePaise: number;
  activeConsultations: number;
  totalDoctors: number;
  totalPatients: number;
}

interface PendingDoctor {
  id: string;
  name: string;
  email: string;
  specialty: string;
  licenseNumber: string;
  yearsOfExperience: number;
  submittedAt: string;
}

interface LedgerItem {
  id: string;
  transactionId: string;
  reference: string;
  description: string;
  accountType: string;
  entryType: 'DEBIT' | 'CREDIT';
  amountPaise: number;
  createdAt: string;
}

interface AuditLogItem {
  id: string;
  action: string;
  actor: string;
  resource: string;
  patientId: string;
  timestamp: string;
  ip: string;
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'stats' | 'verification' | 'ledger' | 'audit'>('stats');

  // Stats query
  const { data: stats, isLoading: statsLoading } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: () => fetchApi('/admin/stats'),
    refetchInterval: 30000,
  });

  // Pending doctors query
  const { data: pendingDoctors = [], isLoading: doctorsLoading } = useQuery<PendingDoctor[]>({
    queryKey: ['admin-pending-doctors'],
    queryFn: async () => {
      const res = await fetchApi<{ doctors: any[] }>('/admin/doctors/pending');
      const docs = res.doctors || [];
      return docs.map((d: any) => ({
        id: d.id,
        name: d.user?.name || 'Dr. ' + (d.specialty || 'Physician'),
        email: d.user?.email || '',
        specialty: d.specialty || 'General Medicine',
        licenseNumber: d.licenseNumber || 'PENDING_VERIF',
        yearsOfExperience: d.experienceYears || 5,
        submittedAt: new Date(d.createdAt).toLocaleString(),
      }));
    },
  });

  // Ledger entries query
  const { data: ledgerEntries = [], isLoading: ledgersLoading } = useQuery<LedgerItem[]>({
    queryKey: ['admin-ledgers'],
    queryFn: () => fetchApi('/admin/ledgers'),
  });

  // Audit logs query
  const { data: auditLogs = [], isLoading: auditLoading } = useQuery<AuditLogItem[]>({
    queryKey: ['admin-audit-logs'],
    queryFn: () => fetchApi('/admin/audit-logs'),
  });

  // Verification mutations
  const verifyMutation = useMutation({
    mutationFn: ({ id, status, rejectionReason }: { id: string; status: 'APPROVED' | 'REJECTED'; rejectionReason?: string }) =>
      fetchApi(`/admin/doctors/${id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ status, rejectionReason }),
      }),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-pending-doctors'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      alert(vars.status === 'APPROVED' ? 'Doctor successfully verified and activated.' : 'Doctor application rejected.');
    },
    onError: (err: any) => {
      alert(`Error updating verification status: ${err.message || 'Action failed'}`);
    },
  });

  // Reconciliation mutation
  const reconcileMutation = useMutation({
    mutationFn: () => fetchApi<{ reconciledCount: number; message: string }>('/admin/payments/reconcile', { method: 'POST' }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['admin-ledgers'] });
      alert(res?.message || 'Payment reconciliation completed successfully.');
    },
    onError: (err: any) => {
      alert(`Reconciliation error: ${err.message || 'Operation failed'}`);
    },
  });

  return (
    <RoleGuard allowedRoles={['ADMIN']}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">Admin Operations Portal</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Doctor verification audit, double-entry financial ledger integrity, and immutable compliance logs
          </p>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold overflow-x-auto">
          <button
            onClick={() => setActiveTab('stats')}
            className={`px-3.5 py-2 rounded-lg transition-colors whitespace-nowrap ${activeTab === 'stats' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            Overview Stats
          </button>
          <button
            onClick={() => setActiveTab('verification')}
            className={`px-3.5 py-2 rounded-lg transition-colors whitespace-nowrap ${activeTab === 'verification' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            Verification ({pendingDoctors.length})
          </button>
          <button
            onClick={() => setActiveTab('ledger')}
            className={`px-3.5 py-2 rounded-lg transition-colors whitespace-nowrap ${activeTab === 'ledger' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            Double-Entry Ledger
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-3.5 py-2 rounded-lg transition-colors whitespace-nowrap ${activeTab === 'audit' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-xs' : 'text-slate-500'}`}
          >
            Audit Trail
          </button>
        </div>
      </div>

      {/* Overview Stats Tab */}
      {activeTab === 'stats' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-4">
              <div className="p-3 bg-amber-50 dark:bg-amber-950/50 rounded-xl text-amber-600">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs text-slate-500">Pending Doctors</span>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {statsLoading ? '...' : stats?.pendingDoctorsCount ?? 0}
                </p>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-4">
              <div className="p-3 bg-rose-50 dark:bg-rose-950/50 rounded-xl text-rose-600">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs text-slate-500">Stuck Payments (&gt;15m)</span>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {statsLoading ? '...' : stats?.stuckPaymentsCount ?? 0}
                </p>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-4">
              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/50 rounded-xl text-emerald-600">
                <CreditCard className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs text-slate-500">Total Captured Revenue</span>
                <p className="text-2xl font-bold text-emerald-600">
                  {statsLoading ? '...' : formatPaise(stats?.totalPlatformRevenuePaise ?? 0)}
                </p>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-4">
              <div className="p-3 bg-teal-50 dark:bg-teal-950/50 rounded-xl text-teal-600">
                <Video className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs text-slate-500">Active Live Consultations</span>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {statsLoading ? '...' : stats?.activeConsultations ?? 0}
                </p>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-4">
              <div className="p-3 bg-blue-50 dark:bg-blue-950/50 rounded-xl text-blue-600">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs text-slate-500">Verified Doctors</span>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {statsLoading ? '...' : stats?.totalDoctors ?? 0}
                </p>
              </div>
            </div>

            <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center gap-4">
              <div className="p-3 bg-purple-50 dark:bg-purple-950/50 rounded-xl text-purple-600">
                <UserCheck className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xs text-slate-500">Registered Patients</span>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">
                  {statsLoading ? '...' : stats?.totalPatients ?? 0}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Verification Queue */}
      {activeTab === 'verification' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Pending Doctor Verification Applications</h2>
            <span className="text-xs text-slate-400">Strict NMC registration check required</span>
          </div>

          {doctorsLoading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-teal-600 mx-auto" />
            </div>
          ) : pendingDoctors.length === 0 ? (
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
                        {doc.licenseNumber}
                      </span>
                    </div>
                    <p className="text-xs text-teal-600 font-semibold">{doc.specialty}</p>
                    <p className="text-xs text-slate-500">
                      Email: {doc.email} • Experience: {doc.yearsOfExperience} Years • Submitted: {doc.submittedAt}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 pt-2 sm:pt-0">
                    <button
                      onClick={() => verifyMutation.mutate({ id: doc.id, status: 'REJECTED', rejectionReason: 'Documentation mismatch' })}
                      disabled={verifyMutation.isPending}
                      className="px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => verifyMutation.mutate({ id: doc.id, status: 'APPROVED' })}
                      disabled={verifyMutation.isPending}
                      className="px-5 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
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
              onClick={() => reconcileMutation.mutate()}
              disabled={reconcileMutation.isPending}
              className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <RotateCcw className={`w-3.5 h-3.5 text-teal-600 ${reconcileMutation.isPending ? 'animate-spin' : ''}`} />
              Run Reconciliation Job
            </button>
          </div>

          {ledgersLoading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-teal-600 mx-auto" />
            </div>
          ) : ledgerEntries.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-400">No ledger transactions recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <table className="w-full text-left text-xs text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 font-bold text-slate-800 dark:text-slate-200">
                  <tr>
                    <th className="p-3.5">Reference</th>
                    <th className="p-3.5">Description</th>
                    <th className="p-3.5">Account Type</th>
                    <th className="p-3.5">Entry Type</th>
                    <th className="p-3.5">Amount</th>
                    <th className="p-3.5">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {ledgerEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 font-mono text-[11px]">
                      <td className="p-3.5 font-semibold text-teal-600">{entry.reference}</td>
                      <td className="p-3.5 font-sans">{entry.description}</td>
                      <td className="p-3.5 font-sans font-medium text-slate-800 dark:text-slate-200">{entry.accountType}</td>
                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            entry.entryType === 'CREDIT'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          }`}
                        >
                          {entry.entryType}
                        </span>
                      </td>
                      <td className="p-3.5 font-bold text-slate-900 dark:text-white">
                        {formatPaise(entry.amountPaise)}
                      </td>
                      <td className="p-3.5 text-slate-400 font-sans">
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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

          {auditLoading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-teal-600 mx-auto" />
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
              <p className="text-xs text-slate-400">No audit logs recorded yet.</p>
            </div>
          ) : (
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
                      <td className="p-3.5 text-slate-400">{new Date(log.timestamp).toLocaleString()}</td>
                      <td className="p-3.5">
                        <span className="font-bold text-teal-600">{log.action}</span>
                      </td>
                      <td className="p-3.5 text-slate-800 dark:text-slate-200 font-sans">{log.actor}</td>
                      <td className="p-3.5 font-sans">{log.resource}</td>
                      <td className="p-3.5 text-slate-400">{log.ip}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
    </RoleGuard>
  );
}
