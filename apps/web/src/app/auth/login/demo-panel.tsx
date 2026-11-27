'use client';

import React from 'react';
import { User, Stethoscope, ShieldCheck, Ambulance, ArrowRight } from 'lucide-react';
import { type UserSession } from '@/lib/api';

interface DemoAccount {
  role: UserSession['role'];
  email: string;
  label: string;
  icon: typeof User;
  targetUrl: string;
}

const DEMO_ACCOUNTS: DemoAccount[] = [
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

interface DemoLoginPanelProps {
  loading: boolean;
  onSelectDemo: (email: string, password: string, targetUrl: string) => void;
}

/**
 * Isolated demo-account quick login panel, dynamically loaded only when
 * NEXT_PUBLIC_SHOW_DEMO_LOGINS === 'true'.
 */
export default function DemoLoginPanel({ loading, onSelectDemo }: DemoLoginPanelProps) {
  return (
    <div className="p-4 rounded-2xl bg-teal-50/80 dark:bg-teal-950/40 border border-teal-200/80 dark:border-teal-900/60 space-y-2.5">
      <div className="text-xs font-bold text-teal-800 dark:text-teal-200">
        1-Click Seeded Account Sign-In:
      </div>
      <div className="grid grid-cols-1 gap-2">
        {DEMO_ACCOUNTS.map((acc) => {
          const Icon = acc.icon;
          return (
            <button
              key={acc.role}
              type="button"
              disabled={loading}
              onClick={() => onSelectDemo(acc.email, 'Password123!', acc.targetUrl)}
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
  );
}
