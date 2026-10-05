'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  push: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((current) => [...current.slice(-2), { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Screen-reader friendly: polite live region, never steals focus (§40). */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:items-end sm:px-0"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3.5 text-sm shadow-soft animate-fade-up backdrop-blur',
              toast.tone === 'success' && 'border-positive/25 bg-positive/[0.08] text-mist-100',
              toast.tone === 'error' && 'border-critical/30 bg-critical/[0.08] text-mist-100',
              toast.tone === 'info' && 'border-white/[0.1] bg-ink-800/90 text-mist-100',
            )}
          >
            <span className="mt-0.5 shrink-0">
              {toast.tone === 'success' ? (
                <CheckCircle2 className="h-4 w-4 text-positive" aria-hidden="true" />
              ) : toast.tone === 'error' ? (
                <AlertTriangle className="h-4 w-4 text-critical" aria-hidden="true" />
              ) : (
                <Info className="h-4 w-4 text-violet-300" aria-hidden="true" />
              )}
            </span>
            <p className="flex-1 break-anywhere">{toast.message}</p>
            <button
              type="button"
              onClick={() => setToasts((current) => current.filter((entry) => entry.id !== toast.id))}
              className="shrink-0 text-mist-400 transition-colors hover:text-mist-100"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  return context ?? { push: () => undefined };
}
