import React from 'react';
import Link from 'next/link';
import { Stethoscope, ShieldAlert, ArrowLeft, Home } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center space-y-6 p-8 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400 flex items-center justify-center">
          <Stethoscope className="w-8 h-8" />
        </div>

        <div className="space-y-2">
          <span className="text-xs font-mono font-bold tracking-wider text-teal-600 dark:text-teal-400 uppercase">
            Error 404
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">
            Page Not Found
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            The medical record, consultation room, or directory page you requested could not be located.
          </p>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Link
            href="/"
            className="w-full py-3 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2"
          >
            <Home className="w-4 h-4" /> Back to Homepage
          </Link>
          <Link
            href="/doctors"
            className="w-full py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Find Doctors
          </Link>
          <Link
            href="/emergency"
            className="w-full py-2.5 px-4 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 font-semibold text-xs transition-colors flex items-center justify-center gap-2"
          >
            <ShieldAlert className="w-4 h-4" /> Emergency Dispatch (112 / 108)
          </Link>
        </div>
      </div>
    </div>
  );
}
