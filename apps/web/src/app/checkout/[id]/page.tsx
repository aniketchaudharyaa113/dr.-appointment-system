'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n';
import { fetchApi, formatIstDateTime } from '@/lib/api';
import { formatPaise } from '@/lib/utils';
import {
  CreditCard,
  ShieldCheck,
  Clock,
  ArrowLeft,
  Sparkles,
  Lock,
  AlertCircle,
} from 'lucide-react';

interface AppointmentDetail {
  id: string;
  bookingRef: string;
  doctorId: string;
  doctorName: string;
  specialty: string;
  consultationFeePaise: number;
  slotTime: string;
  consultationMode: 'VIDEO' | 'IN_CLINIC' | 'CHAT';
  status: string;
  createdAt: string;
  payment: {
    id: string;
    status: string;
    amountPaise: number;
    provider: string;
    providerOrderId: string;
  } | null;
}

interface CheckoutResponse {
  paymentId: string;
  providerOrderId: string;
  amountPaise: number;
  currency: string;
  status: string;
  provider: string;
}

export default function CheckoutPage() {
  const { t } = useI18n();
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const appointmentId = params?.id as string;

  const idempotencyKeyRef = useRef<string>(
    typeof crypto !== 'undefined' ? crypto.randomUUID() : `idem-${Date.now()}`,
  );

  const [paymentOrder, setPaymentOrder] = useState<CheckoutResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(900);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const apptQuery = useQuery<AppointmentDetail>({
    queryKey: ['appointment', appointmentId],
    queryFn: () => fetchApi<AppointmentDetail>(`/appointments/${appointmentId}`),
    enabled: !!appointmentId,
  });

  const createCheckoutMutation = useMutation({
    mutationFn: () =>
      fetchApi<CheckoutResponse>('/payments/checkout', {
        method: 'POST',
        body: JSON.stringify({
          appointmentId,
          idempotencyKey: idempotencyKeyRef.current,
        }),
      }),
    onSuccess: (order) => {
      setCheckoutError(null);
      setPaymentOrder(order);
    },
    onError: (err: Error) => {
      setCheckoutError(err.message);
    },
  });

  // Automatically create payment order once PENDING_PAYMENT appointment loads
  useEffect(() => {
    const appt = apptQuery.data;
    if (!appt) return;

    if (appt.status === 'CONFIRMED') {
      router.replace(`/appointments/${appointmentId}/confirmed`);
      return;
    }

    if (appt.payment && (appt.payment.status === 'INITIATED' || appt.payment.status === 'PENDING')) {
      setPaymentOrder({
        paymentId: appt.payment.id,
        providerOrderId: appt.payment.providerOrderId,
        amountPaise: appt.payment.amountPaise,
        currency: 'INR',
        status: appt.payment.status,
        provider: appt.payment.provider,
      });
      return;
    }

    if (
      appt.status === 'PENDING_PAYMENT' &&
      !paymentOrder &&
      !createCheckoutMutation.isPending &&
      !createCheckoutMutation.isError
    ) {
      createCheckoutMutation.mutate();
    }
  }, [apptQuery.data, appointmentId, router, paymentOrder, createCheckoutMutation]);

  // Countdown from appointment createdAt + 15 minutes
  useEffect(() => {
    const appt = apptQuery.data;
    if (!appt) return;
    const expiryMs = new Date(appt.createdAt).getTime() + 15 * 60 * 1000;
    const update = () => {
      setSecondsLeft(Math.max(0, Math.floor((expiryMs - Date.now()) / 1000)));
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [apptQuery.data]);

  const simulateWebhookMutation = useMutation({
    mutationFn: (event: 'payment.captured' | 'payment.failed') => {
      if (!paymentOrder) throw new Error('Payment order not initialized');
      return fetchApi<{ status: string }>('/payments/dev/simulate-webhook', {
        method: 'POST',
        body: JSON.stringify({
          paymentId: paymentOrder.paymentId,
          event,
        }),
      });
    },
    onSuccess: (res, event) => {
      if (event === 'payment.failed') {
        setCheckoutError('Simulated payment failure: payment declined. You can retry payment before expiry.');
        return;
      }
      if (res.status === 'CAPTURED' || res.status === 'ALREADY_CAPTURED') {
        queryClient.invalidateQueries({ queryKey: ['appointment', appointmentId] });
        queryClient.invalidateQueries({ queryKey: ['my-appointments'] });
        router.push(`/appointments/${appointmentId}/confirmed`);
      } else if (res.status === 'AUTO_REFUNDED') {
        setCheckoutError('Slot expired before payment captured — automatic refund initiated.');
      }
    },
    onError: (err: Error) => {
      setCheckoutError(err.message);
    },
  });

  const formatTimer = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (apptQuery.isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center text-sm text-slate-500">
        Loading checkout details...
      </div>
    );
  }

  if (apptQuery.isError || !apptQuery.data) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <p className="text-sm font-bold text-rose-600">
          {(apptQuery.error as Error)?.message || 'Unable to load appointment for checkout'}
        </p>
        <Link href="/doctors" className="text-xs font-semibold text-teal-600 underline">
          Return to Doctors
        </Link>
      </div>
    );
  }

  const appt = apptQuery.data;
  const amountPaise = paymentOrder?.amountPaise ?? appt.consultationFeePaise;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <Link
        href="/doctors"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-teal-600 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" /> Cancel & Return to Doctors
      </Link>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
            {t.checkout.title}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Booking Ref: <span className="font-mono font-semibold">{appt.bookingRef || appt.id}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs font-bold">
          <Clock className="w-4 h-4 text-amber-600" />
          <span>Payment Window Remaining:</span>
          <span className="font-mono text-sm font-extrabold text-amber-700 dark:text-amber-300">
            {formatTimer(secondsLeft)}
          </span>
        </div>
      </div>

      {checkoutError && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{checkoutError}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-teal-600" /> Payment Order Details
            </h2>

            {paymentOrder ? (
              <div className="p-4 rounded-2xl border border-teal-600 bg-teal-50/50 dark:bg-teal-950/40 space-y-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-slate-900 dark:text-white">
                    Provider: {paymentOrder.provider}
                  </span>
                  <span className="font-mono text-[11px] bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300 px-2 py-0.5 rounded font-bold">
                    {paymentOrder.status}
                  </span>
                </div>
                <p className="text-slate-500 font-mono">Order ID: {paymentOrder.providerOrderId}</p>
              </div>
            ) : (
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                Initializing payment order with backend...
              </div>
            )}

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <button
                type="button"
                disabled={!paymentOrder || simulateWebhookMutation.isPending || secondsLeft === 0}
                onClick={() => simulateWebhookMutation.mutate('payment.captured')}
                className="w-full py-3.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
              >
                {simulateWebhookMutation.isPending ? (
                  <>
                    <Sparkles className="w-4 h-4 animate-spin" /> Verifying Signed Webhook & Balancing Ledger...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" /> Simulate Payment ({formatPaise(amountPaise)}) via Signed Webhook
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={!paymentOrder || simulateWebhookMutation.isPending}
                onClick={() => simulateWebhookMutation.mutate('payment.failed')}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-semibold transition-colors"
              >
                Simulate Payment Failure (Signed Failure Webhook)
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{t.checkout.guarantee}</span>
            </div>
          </div>
        </div>

        {/* Order Summary */}
        <div className="space-y-6">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{t.checkout.orderSummary}</h2>

            <div className="space-y-2 pb-4 border-b border-slate-100 dark:border-slate-800 text-xs">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Doctor:</span>
                <span className="font-semibold text-slate-900 dark:text-white">{appt.doctorName}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Specialty:</span>
                <span className="font-semibold text-slate-900 dark:text-white">{appt.specialty}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Slot (IST):</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {formatIstDateTime(appt.slotTime)}
                </span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Mode:</span>
                <span className="font-semibold text-teal-600 dark:text-teal-400">{appt.consultationMode}</span>
              </div>
            </div>

            <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              <div className="flex justify-between">
                <span>{t.checkout.consultationFee}</span>
                <span className="font-medium text-slate-900 dark:text-white">{formatPaise(amountPaise)}</span>
              </div>
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-baseline font-bold text-base text-slate-900 dark:text-white">
                <span>{t.checkout.totalPayable}</span>
                <span className="text-xl text-teal-600 dark:text-teal-400 font-extrabold">
                  {formatPaise(amountPaise)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
