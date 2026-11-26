'use client';

import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ShieldAlert, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface RoleGuardProps {
  allowedRoles: Array<'PATIENT' | 'DOCTOR' | 'ADMIN' | 'DRIVER'>;
  children: React.ReactNode;
}

export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push(`/auth/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [user, isLoading, router, pathname]);

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-6 text-center space-y-4">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
          Verifying security clearance...
        </p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (!allowedRoles.includes(user.role)) {
    return (
      <div className="max-w-md mx-auto my-16 p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl text-center space-y-6">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">
            Access Restricted
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            This portal is reserved for {allowedRoles.join(' or ')} accounts. You are currently signed in as a <span className="font-semibold text-teal-600">{user.role}</span>.
          </p>
        </div>
        <div className="flex flex-col gap-2 pt-2">
          <Link
            href="/"
            className="w-full py-2.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Return to Homepage
          </Link>
          <Link
            href="/auth/login"
            className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors"
          >
            Switch Account
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
