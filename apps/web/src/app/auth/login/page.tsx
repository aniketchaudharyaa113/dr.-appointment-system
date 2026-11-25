'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchApi, setCurrentUser, type UserSession } from '@/lib/api';
import { Activity, ShieldCheck, User, Stethoscope, Ambulance, Lock, ArrowRight, AlertCircle } from 'lucide-react';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get('redirect');

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('patient@medibook.test');
  const [password, setPassword] = useState('Password123!');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const demoAccounts: {
    role: UserSession['role'];
    email: string;
    label: string;
    icon: any;
    targetUrl: string;
  }[] = [
    {
      role: 'PATIENT',
      email: 'patient@medibook.test',
      label: 'Patient (Anita Roy)',
      icon: User,
      targetUrl: '/doctors',
    },
    {
      role: 'DOCTOR',
      email: 'doctor@medibook.test',
      label: 'Doctor (Dr. Subhash Chandra)',
      icon: Stethoscope,
      targetUrl: '/doctor/dashboard',
    },
    {
      role: 'ADMIN',
      email: 'admin@medibook.test',
      label: 'Admin (Compliance & Audit)',
      icon: ShieldCheck,
      targetUrl: '/admin',
    },
    {
      role: 'DRIVER',
      email: 'driver@medibook.test',
      label: 'Ambulance Driver (Vikram Singh)',
      icon: Ambulance,
      targetUrl: '/emergency',
    },
  ];

  const performLogin = async (loginEmail: string, loginPassword: string, fallbackUrl: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchApi<{
        user: { id: string; email: string; name: string; role: UserSession['role'] };
        accessToken: string;
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });

      setCurrentUser({
        id: res.user.id,
        name: res.user.name,
        email: res.user.email,
        role: res.user.role,
        token: res.accessToken,
      });

      router.push(redirectParam || fallbackUrl);
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'login') {
      const matched = demoAccounts.find((a) => a.email === email);
      await performLogin(email, password, matched?.targetUrl || '/doctors');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetchApi<{
        user: { id: string; email: string; name: string; role: UserSession['role'] };
        accessToken: string;
      }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, role: 'PATIENT' }),
      });

      setCurrentUser({
        id: res.user.id,
        name: res.user.name,
        email: res.user.email,
        role: res.user.role,
        token: res.accessToken,
      });

      router.push(redirectParam || '/doctors');
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-12 space-y-6">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center mx-auto shadow-md">
          <Activity className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {mode === 'login' ? 'Sign In to MediBook' : 'Create Patient Account'}
        </h1>
        <p className="text-xs text-slate-500">
          Real JWT + rotating refresh token authentication against PostgreSQL
        </p>
      </div>

      {/* 1-Click Demo Accounts */}
      <div className="p-4 rounded-2xl bg-teal-50/60 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900/60 space-y-2.5">
        <div className="text-xs font-bold text-teal-800 dark:text-teal-200">
          1-Click Seeded Account Sign-In:
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {demoAccounts.map((acc) => {
            const Icon = acc.icon;
            return (
              <button
                key={acc.role}
                type="button"
                disabled={loading}
                onClick={() => performLogin(acc.email, 'Password123!', acc.targetUrl)}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-teal-100 dark:border-teal-900 hover:border-teal-400 disabled:opacity-50 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors shadow-xs"
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-teal-600" />
                  <span>{acc.label}</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            );
          })}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs font-medium flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4"
      >
        <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
          <button
            type="button"
            onClick={() => setMode('login')}
            className={`flex-1 py-1.5 rounded-lg ${mode === 'login' ? 'bg-white dark:bg-slate-900 text-teal-600 shadow-xs' : 'text-slate-500'}`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => setMode('register')}
            className={`flex-1 py-1.5 rounded-lg ${mode === 'register' ? 'bg-white dark:bg-slate-900 text-teal-600 shadow-xs' : 'text-slate-500'}`}
          >
            Register
          </button>
        </div>

        {mode === 'register' && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Full Name
            </label>
            <input
              type="text"
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aarav Chatterjee"
              className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Email Address
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Password
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>{loading ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Account'}</span>
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-sm text-slate-500">Loading sign in...</div>}>
      <LoginContent />
    </Suspense>
  );
}
