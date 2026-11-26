'use client';

import React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl border border-slate-200 shadow-xl text-center space-y-4">
          <h1 className="text-2xl font-bold text-rose-600">Critical Error</h1>
          <p className="text-sm text-slate-600">
            {error.message || 'A critical system error occurred. Please refresh the browser.'}
          </p>
          <button
            onClick={() => reset()}
            className="w-full py-2.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm transition-colors"
          >
            Reload Application
          </button>
        </div>
      </body>
    </html>
  );
}
