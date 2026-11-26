'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string) => {
      const id = Math.random().toString(36).substring(2, 9);
      setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
      setTimeout(() => {
        removeToast(id);
      }, 4000);
    },
    [removeToast],
  );

  const success = useCallback((msg: string) => addToast('success', msg), [addToast]);
  const error = useCallback((msg: string) => addToast('error', msg), [addToast]);
  const info = useCallback((msg: string) => addToast('info', msg), [addToast]);

  return (
    <ToastContext.Provider value={{ success, error, info }}>
      {children}
      {/* Toast Notification Container */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-2xl border shadow-xl backdrop-blur-md transition-all duration-300 animate-in slide-in-from-bottom-2 ${
              t.type === 'success'
                ? 'bg-emerald-50/95 dark:bg-emerald-950/90 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
                : t.type === 'error'
                ? 'bg-rose-50/95 dark:bg-rose-950/90 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-100'
                : 'bg-slate-50/95 dark:bg-slate-900/90 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100'
            }`}
          >
            {t.type === 'success' && <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />}
            {t.type === 'error' && <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />}
            {t.type === 'info' && <Info className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />}
            <p className="text-xs font-semibold leading-relaxed flex-1">{t.message}</p>
            <button
              onClick={() => removeToast(t.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
              aria-label="Close Notification"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback if rendered outside provider
    return {
      success: (msg: string) => console.log('Toast success:', msg),
      error: (msg: string) => console.error('Toast error:', msg),
      info: (msg: string) => console.info('Toast info:', msg),
    };
  }
  return context;
}
