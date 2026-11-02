'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setCurrentUser, type UserSession } from '@/lib/api';
import { Activity, ShieldCheck, User, Stethoscope, Ambulance, Lock, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('patient@medibook.test');
  const [password, setPassword] = useState('Password123!');
  const [loading, setLoading] = useState(false);

  const demoAccounts: {
    role: UserSession['role'];
    email: string;
    label: string;
    name: string;
    icon: any;
    targetUrl: string;
  }[] = [
    {
      role: 'PATIENT',
      email: 'patient@medibook.test',
      label: 'Patient (Aniket Chaudhary)',
      name: 'Aniket Chaudhary',
      icon: User,
      targetUrl: '/doctors',
    },
    {
      role: 'DOCTOR',
      email: 'doctor@medibook.test',
      label: 'Doctor (Dr. Arindam Mukherjee)',
      name: 'Dr. Arindam Mukherjee',
      icon: Stethoscope,
      targetUrl: '/doctor/dashboard',
    },
    {
      role: 'ADMIN',
      email: 'admin@medibook.test',
      label: 'Admin (Compliance & Audit)',
      name: 'System Administrator',
      icon: ShieldCheck,
      targetUrl: '/admin',
    },
    {
      role: 'DRIVER',
      email: 'driver@medibook.test',
      label: 'Ambulance Driver (Rajesh)',
      name: 'Rajesh Karmakar',
      icon: Ambulance,
      targetUrl: '/emergency',
    },
  ];

  const handleQuickLogin = (account: (typeof demoAccounts)[0]) => {
    setLoading(true);
    setCurrentUser({
      id: `usr-${account.role.toLowerCase()}-1`,
      name: account.name,
      email: account.email,
      role: account.role,
      token: `demo-jwt-${account.role.toLowerCase()}-${Date.now()}`,
    });
    setTimeout(() => {
      setLoading(false);
      router.push(account.targetUrl);
    }, 400);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const matched = demoAccounts.find((a) => a.email === email) || demoAccounts[0];
    setCurrentUser({
      id: `usr-${matched.role.toLowerCase()}-1`,
      name: matched.name,
      email: matched.email,
      role: matched.role,
      token: `demo-jwt-${matched.role.toLowerCase()}-${Date.now()}`,
    });
    setTimeout(() => {
      setLoading(false);
      router.push(matched.targetUrl);
    }, 400);
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16 space-y-6">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center mx-auto shadow-md">
          <Activity className="w-7 h-7" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Sign In to MediBook</h1>
        <p className="text-xs text-slate-500">
          Access your appointments, clinical workspace, or dispatch telemetry
        </p>
      </div>

      {/* 1-Click Demo Accounts */}
      <div className="p-4 rounded-2xl bg-teal-50/60 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-900/60 space-y-2.5">
        <div className="text-xs font-bold text-teal-800 dark:text-teal-200">1-Click Demo Account Login:</div>
        <div className="grid grid-cols-1 gap-1.5">
          {demoAccounts.map((acc) => {
            const Icon = acc.icon;
            return (
              <button
                key={acc.role}
                onClick={() => handleQuickLogin(acc)}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-teal-100 dark:border-teal-900 hover:border-teal-400 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors shadow-xs"
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

      <form onSubmit={handleSubmit} className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Email Address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-1.5"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Sign In</span>
        </button>
      </form>
    </div>
  );
}
