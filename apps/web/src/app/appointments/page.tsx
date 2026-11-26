'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  Video,
  Building,
  FileText,
  AlertTriangle,
  XCircle,
  AlertCircle,
  CreditCard,
  Calendar,
  Star,
} from 'lucide-react';
import { fetchApi, formatIstDateTime, getCurrentUser } from '@/lib/api';
import { formatPaise } from '@/lib/utils';

interface AppointmentItem {
  id: string;
  bookingRef: string | null;
  doctorName: string;
  specialty: string;
  slotTime: string;
  consultationMode: 'VIDEO' | 'IN_CLINIC' | 'CHAT';
  status: string;
  consultationFeePaise: number;
  payment: {
    id: string;
    status: string;
    amountPaise: number;
  } | null;
  prescription: {
    id: string;
    currentVersion: number;
  } | null;
  review?: {
    id: string;
    rating: number;
    comment?: string;
  } | null;
}

export default function MyAppointmentsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');
  const [selectedMode, setSelectedMode] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [cancelModalApt, setCancelModalApt] = useState<AppointmentItem | null>(null);
  const [reviewModalApt, setReviewModalApt] = useState<AppointmentItem | null>(null);
  const [reviewRating, setReviewRating] = useState<number>(5);
  const [reviewComment, setReviewComment] = useState<string>('');
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const user = typeof window !== 'undefined' ? getCurrentUser() : null;

  const { data: appointmentData, isLoading, isError, error } = useQuery<{
    items: AppointmentItem[];
    nextCursor: string | null;
  }>({
    queryKey: ['my-appointments', selectedStatus, selectedMode, fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedStatus !== 'ALL') params.set('status', selectedStatus);
      if (selectedMode !== 'ALL') params.set('mode', selectedMode);
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      params.set('limit', '50');

      const res = await fetchApi<any>(`/appointments/mine?${params.toString()}`);
      if (Array.isArray(res)) {
        return { items: res, nextCursor: null };
      }
      return res;
    },
    enabled: !!user?.token,
  });

  const appointments = appointmentData?.items || [];

  const reviewMutation = useMutation({
    mutationFn: async ({ aptId, rating, comment }: { aptId: string; rating: number; comment?: string }) => {
      return fetchApi(`/appointments/${aptId}/review`, {
        method: 'POST',
        body: JSON.stringify({ rating, comment: comment || undefined }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-appointments'] });
      setReviewModalApt(null);
      setReviewComment('');
      setActionMsg('Thank you! Your verified rating and review have been recorded.');
    },
    onError: (err: Error) => {
      setActionMsg(`Review error: ${err.message}`);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (apt: AppointmentItem) => {
      if (apt.payment?.status === 'CAPTURED') {
        return fetchApi(`/payments/${apt.payment.id}/refund`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Patient requested cancellation' }),
        });
      }
      return fetchApi(`/appointments/${apt.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Patient requested cancellation' }),
      });
    },
    onSuccess: () => {
      setCancelModalApt(null);
      setActionMsg('Appointment cancelled and refund processed via outbox.');
      queryClient.invalidateQueries({ queryKey: ['my-appointments'] });
    },
    onError: (err: Error) => {
      setCancelModalApt(null);
      setActionMsg(`Cancellation error: ${err.message}`);
    },
  });

  const upcomingList = appointments.filter((a) =>
    ['PENDING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS'].includes(a.status),
  );
  const pastList = appointments.filter((a) =>
    ['COMPLETED', 'CANCELLED', 'REFUNDED', 'NO_SHOW'].includes(a.status),
  );

  if (!user?.token) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-4">
        <Calendar className="w-10 h-10 text-teal-600 mx-auto" />
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Sign In to View Appointments</h1>
        <p className="text-xs text-slate-500">
          Your appointments are protected by JWT authentication.
        </p>
        <Link
          href="/auth/login?redirect=/appointments"
          className="inline-block px-5 py-2.5 rounded-xl bg-teal-600 text-white text-xs font-bold"
        >
          Sign In
        </Link>
      </div>
    );
  }

  const displayedList = tab === 'upcoming' ? upcomingList : pastList;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white">My Appointments</h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
          Manage your scheduled telehealth consultations, digital prescriptions, and refund status
        </p>
      </div>

      {actionMsg && (
        <div className="p-3.5 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 text-xs font-medium text-teal-800 dark:text-teal-200">
          {actionMsg}
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <label className="block text-slate-500 font-medium mb-1">Status</label>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
            >
              <option value="ALL">All Statuses</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="PENDING_PAYMENT">Pending Payment</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="REFUNDED">Refunded</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-500 font-medium mb-1">Consultation Mode</label>
            <select
              value={selectedMode}
              onChange={(e) => setSelectedMode(e.target.value)}
              className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
            >
              <option value="ALL">All Modes</option>
              <option value="VIDEO">Video Consultation</option>
              <option value="IN_CLINIC">In-Clinic Visit</option>
              <option value="CHAT">Live Chat</option>
            </select>
          </div>
          <div>
            <label className="block text-slate-500 font-medium mb-1">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
            />
          </div>
          <div>
            <label className="block text-slate-500 font-medium mb-1">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
            />
          </div>
        </div>
        {(selectedStatus !== 'ALL' || selectedMode !== 'ALL' || fromDate || toDate) && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => {
                setSelectedStatus('ALL');
                setSelectedMode('ALL');
                setFromDate('');
                setToDate('');
              }}
              className="text-xs font-semibold text-rose-600 hover:underline"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">
        <button
          type="button"
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
          type="button"
          onClick={() => setTab('past')}
          className={`pb-3 px-4 border-b-2 transition-colors ${
            tab === 'past'
              ? 'border-teal-600 text-teal-600 dark:text-teal-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Past & Cancelled ({pastList.length})
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 animate-pulse h-24"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="p-6 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span>{(error as Error)?.message || 'Failed to load appointments'}</span>
        </div>
      ) : displayedList.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
          <Calendar className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="font-bold text-sm text-slate-700 dark:text-slate-300">
            No {tab} appointments found
          </h3>
          <Link
            href="/doctors"
            className="inline-block px-4 py-2 rounded-xl bg-teal-600 text-white text-xs font-bold"
          >
            Find a Doctor
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {displayedList.map((apt) => (
            <div
              key={apt.id}
              className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            >
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">{apt.doctorName}</h3>
                  {apt.bookingRef && (
                    <span className="text-[10px] font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-600 dark:text-slate-300">
                      {apt.bookingRef}
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      apt.status === 'CONFIRMED'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : apt.status === 'PENDING_PAYMENT'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
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
                    <Clock className="w-3.5 h-3.5" /> {formatIstDateTime(apt.slotTime)} (IST)
                  </span>
                  <span className="flex items-center gap-1">
                    {apt.consultationMode === 'VIDEO' ? (
                      <>
                        <Video className="w-3.5 h-3.5 text-teal-600" /> Video Consult
                      </>
                    ) : (
                      <>
                        <Building className="w-3.5 h-3.5" /> {apt.consultationMode}
                      </>
                    )}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-3 sm:pt-0 w-full sm:w-auto border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                {apt.status === 'PENDING_PAYMENT' && (
                  <>
                    <Link
                      href={`/checkout/${apt.id}`}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-sm transition-colors flex items-center gap-1.5"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      Complete Payment
                    </Link>
                    <button
                      type="button"
                      onClick={() => setCancelModalApt(apt)}
                      className="px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold text-xs transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                )}

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
                      type="button"
                      onClick={() => setCancelModalApt(apt)}
                      className="px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 font-semibold text-xs transition-colors"
                    >
                      Cancel
                    </button>
                  </>
                )}

                {apt.status === 'COMPLETED' && (
                  <div className="flex flex-wrap items-center gap-2">
                    {apt.prescription && (
                      <Link
                        href={`/consultation/${apt.id}?tab=prescription`}
                        className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-semibold text-xs transition-colors flex items-center gap-1.5"
                      >
                        <FileText className="w-3.5 h-3.5 text-teal-600" />
                        View Digital Rx (v{apt.prescription.currentVersion})
                      </Link>
                    )}
                    {apt.review ? (
                      <span className="flex items-center gap-1 text-xs text-amber-500 font-bold px-3 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
                        <Star className="w-3.5 h-3.5 fill-current" />
                        Rated {apt.review.rating}/5
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setReviewRating(5);
                          setReviewComment('');
                          setReviewModalApt(apt);
                        }}
                        className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs shadow-sm transition-colors flex items-center gap-1.5"
                      >
                        <Star className="w-3.5 h-3.5" />
                        Rate &amp; Review
                      </button>
                    )}
                  </div>
                )}

                {(apt.status === 'CANCELLED' || apt.status === 'REFUNDED') && (
                  <span className="text-xs text-rose-600 dark:text-rose-400 font-medium flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" />{' '}
                    {apt.status === 'REFUNDED'
                      ? `Refunded (${formatPaise(apt.payment?.amountPaise ?? apt.consultationFeePaise)})`
                      : 'Cancelled'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cancellation Modal */}
      {cancelModalApt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">Cancel Appointment?</h3>
                <p className="text-xs text-slate-500">Slot will be freed immediately</p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Consultation Fee:</span>
                <span className="font-semibold">
                  {formatPaise(cancelModalApt.payment?.amountPaise ?? cancelModalApt.consultationFeePaise)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment State:</span>
                <span className="font-semibold">{cancelModalApt.payment?.status || 'UNPAID'}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCancelModalApt(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Keep Appointment
              </button>
              <button
                type="button"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate(cancelModalApt)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-colors"
              >
                {cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal */}
      {reviewModalApt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-500">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-950 flex items-center justify-center">
                <Star className="w-5 h-5 fill-current" />
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white">
                  Rate Your Consultation
                </h3>
                <p className="text-xs text-slate-500">with {reviewModalApt.doctorName}</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Overall Rating
                </label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setReviewRating(star)}
                      className="p-1 text-amber-500 hover:scale-110 transition-transform"
                      title={`${star} Star${star > 1 ? 's' : ''}`}
                    >
                      <Star
                        className={`w-7 h-7 ${star <= reviewRating ? 'fill-current' : 'text-slate-300 dark:text-slate-600'}`}
                      />
                    </button>
                  ))}
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300 ml-2">
                    {reviewRating} of 5 Stars
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Comments (Optional, max 1000 characters)
                </label>
                <textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value.slice(0, 1000))}
                  placeholder="Share your experience regarding the doctor's communication, diagnosis, and care..."
                  rows={4}
                  className="w-full text-xs p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <span className="text-[10px] text-slate-400 block text-right">
                  {reviewComment.length} / 1000
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setReviewModalApt(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reviewMutation.isPending}
                onClick={() =>
                  reviewMutation.mutate({
                    aptId: reviewModalApt.id,
                    rating: reviewRating,
                    comment: reviewComment,
                  })
                }
                className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition-colors disabled:opacity-50"
              >
                {reviewMutation.isPending ? 'Submitting...' : 'Submit Review'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
