'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { formatPaise } from '@/lib/utils';
import {
  CreditCard,
  ShieldCheck,
  Clock,
  ArrowLeft,
  Sparkles,
  Lock,
} from 'lucide-react';
import Link from 'next/link';

export default function CheckoutPage() {
  const { t } = useI18n();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const appointmentId = (params?.id as string) || 'apt-test-1';
  const slotTime = searchParams.get('slot') || 'Today at 05:30 PM';

  const [holdTimer, setHoldTimer] = useState<number>(540); // 9 minutes left
  const [processing, setProcessing] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'FAKE' | 'RAZORPAY'>('FAKE');

  // Integer paise amounts
  const doctorFeePaise = 80000;
  const platformFeePaise = 5000;
  const gstPaise = Math.round((doctorFeePaise + platformFeePaise) * 0.18);
  const totalPaise = doctorFeePaise + platformFeePaise + gstPaise;

  useEffect(() => {
    const interval = setInterval(() => {
      setHoldTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTimer = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePaySuccess = async () => {
    setProcessing(true);
    // Simulate webhook processing and double-entry ledger capture
    setTimeout(() => {
      setProcessing(false);
      router.push(`/appointments/${appointmentId}/confirmed?slot=${encodeURIComponent(slotTime)}`);
    }, 1200);
  };

  const handlePayFailure = () => {
    setProcessing(true);
    setTimeout(() => {
      setProcessing(false);
      alert('Simulated payment failure: Card declined by issuing bank (Insufficient funds). Your slot remains held.');
    }, 800);
  };

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
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">{t.checkout.title}</h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
            Appointment ID: <span className="font-mono font-semibold">{appointmentId}</span>
          </p>
        </div>

        {/* Hold Countdown */}
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs font-bold">
          <Clock className="w-4 h-4 text-amber-600 animate-spin" style={{ animationDuration: '6s' }} />
          <span>Slot Hold Time Remaining:</span>
          <span className="font-mono text-sm font-extrabold text-amber-700 dark:text-amber-300">
            {formatTimer(holdTimer)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Column: Payment Provider Selection */}
        <div className="md:col-span-2 space-y-6">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-teal-600" /> Select Payment Method
            </h2>

            <div className="space-y-3">
              <label
                onClick={() => setSelectedProvider('FAKE')}
                className={`flex items-start justify-between p-4 rounded-2xl border cursor-pointer transition-all ${
                  selectedProvider === 'FAKE'
                    ? 'border-teal-600 bg-teal-50/50 dark:bg-teal-950/40 ring-2 ring-teal-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="provider"
                    checked={selectedProvider === 'FAKE'}
                    onChange={() => setSelectedProvider('FAKE')}
                    className="mt-1 accent-teal-600"
                  />
                  <div>
                    <span className="font-bold text-sm text-slate-900 dark:text-white block">
                      Fake Payment Provider (Test & Sandbox)
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed block mt-0.5">
                      Deterministic sandbox with 100% HMAC signature simulation, ledger balancing, and error cases.
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-bold uppercase bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300 px-2 py-0.5 rounded">
                  Recommended
                </span>
              </label>

              <label
                onClick={() => setSelectedProvider('RAZORPAY')}
                className={`flex items-start justify-between p-4 rounded-2xl border cursor-pointer transition-all ${
                  selectedProvider === 'RAZORPAY'
                    ? 'border-teal-600 bg-teal-50/50 dark:bg-teal-950/40 ring-2 ring-teal-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="provider"
                    checked={selectedProvider === 'RAZORPAY'}
                    onChange={() => setSelectedProvider('RAZORPAY')}
                    className="mt-1 accent-teal-600"
                  />
                  <div>
                    <span className="font-bold text-sm text-slate-900 dark:text-white block">
                      Razorpay Checkout (UPI / Cards / NetBanking)
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 block mt-0.5">
                      Standard Indian payment gateway with test credentials (rzp_test_...).
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-bold uppercase bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 px-2 py-0.5 rounded">
                  Sandbox
                </span>
              </label>
            </div>

            {/* Test Actions */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <button
                disabled={processing || holdTimer === 0}
                onClick={handlePaySuccess}
                className="w-full py-3.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2"
              >
                {processing ? (
                  <>
                    <Sparkles className="w-4 h-4 animate-spin" /> Verifying Webhook & Balancing Ledger...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" /> Pay {formatPaise(totalPaise)} & Confirm Booking
                  </>
                )}
              </button>

              <button
                disabled={processing}
                onClick={handlePayFailure}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-semibold transition-colors"
              >
                Simulate Payment Failure (Declined Card)
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{t.checkout.guarantee}</span>
            </div>
          </div>
        </div>

        {/* Right Column: Order Summary */}
        <div className="space-y-6">
          <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{t.checkout.orderSummary}</h2>

            <div className="space-y-2 pb-4 border-b border-slate-100 dark:border-slate-800 text-xs">
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Doctor:</span>
                <span className="font-semibold text-slate-900 dark:text-white">Dr. Arindam Mukherjee</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Slot:</span>
                <span className="font-semibold text-slate-900 dark:text-white">{slotTime}</span>
              </div>
              <div className="flex justify-between text-slate-600 dark:text-slate-400">
                <span>Mode:</span>
                <span className="font-semibold text-teal-600 dark:text-teal-400">Encrypted HD Video</span>
              </div>
            </div>

            {/* Financial Ledger Breakdown in Paise */}
            <div className="space-y-2 text-xs text-slate-600 dark:text-slate-400">
              <div className="flex justify-between">
                <span>{t.checkout.consultationFee}</span>
                <span className="font-medium text-slate-900 dark:text-white">{formatPaise(doctorFeePaise)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t.checkout.platformFee}</span>
                <span className="font-medium text-slate-900 dark:text-white">{formatPaise(platformFeePaise)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t.checkout.gst}</span>
                <span className="font-medium text-slate-900 dark:text-white">{formatPaise(gstPaise)}</span>
              </div>
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-between items-baseline font-bold text-base text-slate-900 dark:text-white">
                <span>{t.checkout.totalPayable}</span>
                <span className="text-xl text-teal-600 dark:text-teal-400 font-extrabold">
                  {formatPaise(totalPaise)}
                </span>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-[11px] text-slate-500 space-y-1">
              <div className="font-semibold text-slate-700 dark:text-slate-300">Double-Entry Financial Rule:</div>
              <p>All transactions debit patient balance and credit platform & doctor accounts in integer paise.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
