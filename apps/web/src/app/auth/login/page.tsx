'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type UserSession } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { sanitizeRedirect } from '@/lib/utils';
import { Activity, ShieldCheck, User, Stethoscope, Ambulance, Lock, ArrowRight, AlertCircle } from 'lucide-react';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get('redirect');
  const { login, register } = useAuth();
  const showDemoLogins = process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS === 'true';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [registerRole, setRegisterRole] = useState<'PATIENT' | 'DOCTOR'>('PATIENT');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(showDemoLogins ? 'patient@medibook.test' : '');
  const [password, setPassword] = useState(showDemoLogins ? 'Password123!' : '');
  const [specialty, setSpecialty] = useState('General Medicine');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [experienceYears, setExperienceYears] = useState(5);
  const [consultationFee, setConsultationFee] = useState(500);
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
      await login(loginEmail, loginPassword);
      router.push(sanitizeRedirect(redirectParam, fallbackUrl));
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'login') {
      const matched = demoAccounts.find((a) => a.email === email.trim());
      await performLogin(email.trim(), password, matched?.targetUrl || '/doctors');
      return;
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (trimmedName.length < 2) {
      setErrorMsg('Full name must be at least 2 characters long.');
      return;
    }
    if (
      password.length < 8 ||
      !/[A-Za-z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      setErrorMsg(
        'Password must be at least 8 characters long and contain at least one letter and one number.',
      );
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const payload: any = {
        name: trimmedName,
        email: trimmedEmail,
        password,
        role: registerRole,
      };

      if (registerRole === 'DOCTOR') {
        payload.specialty = specialty;
        payload.licenseNumber = (licenseNumber || '').trim() || 'WBMC/' + Math.floor(10000 + Math.random() * 90000);
        payload.experienceYears = Number(experienceYears);
        payload.consultationFeePaise = Math.round(Number(consultationFee) * 100);
      }

      const registeredUser = await register(payload);
      const fallback = registeredUser.role === 'DOCTOR' ? '/doctor/dashboard' : '/doctors';
      router.push(sanitizeRedirect(redirectParam, fallback));
    } catch (err: any) {
      setErrorMsg(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const headingTitle =
    mode === 'login'
      ? 'Sign In to MediBook'
      : registerRole === 'DOCTOR'
        ? 'Create Doctor Account'
        : 'Create Patient Account';

  return (
    <div className="min-h-[80vh] bg-clinical-grid py-12 px-4">
      <div className="max-w-md mx-auto space-y-6">
        <div className="text-center space-y-2.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-500 to-teal-700 text-white flex items-center justify-center mx-auto shadow-lg shadow-teal-600/20">
            <Activity className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
            {headingTitle}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Verified Telehealth Platform • Encrypted Clinical Access
          </p>
        </div>

        {/* 1-Click Demo Accounts */}
        {showDemoLogins && (
          <div className="p-4 rounded-2xl bg-teal-50/80 dark:bg-teal-950/40 border border-teal-200/80 dark:border-teal-900/60 space-y-2.5">
            <div className="text-xs font-bold text-teal-800 dark:text-teal-200">
              1-Click Seeded Account Sign-In:
            </div>
            <div className="grid grid-cols-1 gap-2">
              {demoAccounts.map((acc) => {
                const Icon = acc.icon;
                return (
                  <button
                    key={acc.role}
                    type="button"
                    disabled={loading}
                    onClick={() => performLogin(acc.email, 'Password123!', acc.targetUrl)}
                    className="w-full flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-teal-100 dark:border-teal-900 hover:border-teal-400 disabled:opacity-50 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors shadow-sm"
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4 text-teal-600" aria-hidden="true" />
                      <span>{acc.label}</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs sm:text-sm font-medium flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="p-6 sm:p-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-xl space-y-5"
        >
          <div className="flex gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs sm:text-sm font-semibold">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg(null);
              }}
              className={`flex-1 py-2 rounded-lg transition-all ${mode === 'login' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-slate-500'}`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMsg(null);
              }}
              className={`flex-1 py-2 rounded-lg transition-all ${mode === 'register' ? 'bg-white dark:bg-slate-900 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-slate-500'}`}
            >
              Register
            </button>
          </div>

          {mode === 'register' && (
            <>
              <div>
                <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Account Type
                </span>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setRegisterRole('PATIENT');
                      setErrorMsg(null);
                    }}
                    className={`py-2.5 rounded-xl text-xs font-bold border transition-colors ${
                      registerRole === 'PATIENT'
                        ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Patient
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRegisterRole('DOCTOR');
                      setErrorMsg(null);
                    }}
                    className={`py-2.5 rounded-xl text-xs font-bold border transition-colors ${
                      registerRole === 'DOCTOR'
                        ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Doctor / Physician
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="auth-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Full Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={registerRole === 'DOCTOR' ? 'e.g. Dr. Sneha Mukherjee' : 'e.g. Aarav Chatterjee'}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {registerRole === 'DOCTOR' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="auth-specialty" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Specialty
                      </label>
                      <select
                        id="auth-specialty"
                        value={specialty}
                        onChange={(e) => setSpecialty(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      >
                        <option value="General Medicine">General Medicine</option>
                        <option value="Cardiology">Cardiology</option>
                        <option value="Dermatology">Dermatology</option>
                        <option value="Pediatrics">Pediatrics</option>
                        <option value="Neurology">Neurology</option>
                        <option value="Orthopedics">Orthopedics</option>
                        <option value="Psychiatry">Psychiatry</option>
                        <option value="ENT">ENT</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="auth-license" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        License / Reg No.
                      </label>
                      <input
                        id="auth-license"
                        type="text"
                        required
                        value={licenseNumber}
                        onChange={(e) => setLicenseNumber(e.target.value)}
                        placeholder="e.g. WBMC/58291"
                        className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="auth-exp" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Experience (Years)
                      </label>
                      <input
                        id="auth-exp"
                        type="number"
                        min={0}
                        value={experienceYears}
                        onChange={(e) => setExperienceYears(Number(e.target.value))}
                        className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                    <div>
                      <label htmlFor="auth-fee" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Consultation Fee (₹)
                      </label>
                      <input
                        id="auth-fee"
                        type="number"
                        min={100}
                        step={50}
                        value={consultationFee}
                        onChange={(e) => setConsultationFee(Number(e.target.value))}
                        className="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          <div>
            <label htmlFor="auth-email" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Email Address
            </label>
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div>
            <label htmlFor="auth-password" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            {mode === 'register' && (
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                At least 8 characters, including 1 letter and 1 number (e.g. ClinicPass1).
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-bold text-sm shadow-md shadow-teal-600/20 transition-colors flex items-center justify-center gap-2"
          >
            <Lock className="w-4 h-4" aria-hidden="true" />
            <span>{loading ? 'Authenticating...' : mode === 'login' ? 'Sign In' : 'Create Account'}</span>
          </button>
        </form>
      </div>
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
