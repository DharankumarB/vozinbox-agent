'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { AlertCircle } from 'lucide-react';

type Mode = 'login' | 'signup' | 'reset';

export function AuthForm({ mode, nextPath = '/dashboard' }: { mode: Mode; nextPath?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const fullName = String(formData.get('fullName') ?? '').trim();

    if (!email) {
      setError('Please enter your email address.');
      return;
    }
    if (mode !== 'reset' && password.length < 8) {
      setError('Please use a password with at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const timezone =
        typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC';

      if (mode === 'reset') {
        const response = await fetch('/api/auth/password-reset', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const payload = (await response.json()) as
          | { ok: true; data: { delivered: boolean; message: string } }
          | { ok: false; error: { message: string } };
        if (!payload.ok) {
          setError(payload.error.message);
          return;
        }
        setNotice(payload.data.message);
        return;
      }

      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const body =
        mode === 'signup'
          ? { email, password, fullName: fullName || undefined, timezone }
          : { email, password };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as
        | { ok: true; data: { requiresEmailConfirmation?: boolean } }
        | { ok: false; error: { message: string } };

      if (!payload.ok) {
        setError(payload.error.message);
        return;
      }

      if (mode === 'signup' && payload.data.requiresEmailConfirmation) {
        setNotice(
          'Check your inbox — we sent a confirmation link. Once confirmed you can sign in and connect Gmail.',
        );
        return;
      }

      toast.push(mode === 'signup' ? 'Account created.' : 'Welcome back.', 'success');
      router.push(nextPath);
      router.refresh();
    } catch {
      setError('Unable to complete this action. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const titles: Record<Mode, { title: string; subtitle: string; cta: string }> = {
    login: { title: 'Welcome back', subtitle: 'Sign in to your inbox intelligence.', cta: 'Sign in' },
    signup: { title: 'Create your account', subtitle: 'Set up VozInbox in under a minute.', cta: 'Create account' },
    reset: { title: 'Reset your password', subtitle: "We'll email you a secure reset link.", cta: 'Send reset link' },
  };

  return (
    <div className="panel p-6">
      <h2 className="text-lg font-semibold text-mist-50">{titles[mode].title}</h2>
      <p className="mt-1 text-sm text-mist-400">{titles[mode].subtitle}</p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
        {mode === 'signup' ? (
          <div>
            <label className="label" htmlFor="fullName">
              Full name
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              autoComplete="name"
              className="field"
              placeholder="Ada Lovelace"
              maxLength={120}
            />
          </div>
        ) : null}

        <div>
          <label className="label" htmlFor="email">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="field"
            placeholder="you@university.edu"
            aria-describedby={error ? 'auth-error' : undefined}
          />
        </div>

        {mode !== 'reset' ? (
          <div>
            <div className="flex items-center justify-between">
              <label className="label" htmlFor="password">
                Password
              </label>
              {mode === 'login' ? (
                <Link href="/forgot-password" className="mb-1.5 text-[11px] text-violet-300 hover:text-violet-200">
                  Forgot password?
                </Link>
              ) : null}
            </div>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={mode === 'signup' ? 8 : undefined}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              className="field"
              placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
            />
          </div>
        ) : null}

        {error ? (
          <p id="auth-error" role="alert" className="flex items-start gap-2 rounded-xl border border-critical/25 bg-critical/[0.07] p-3 text-xs text-mist-200">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-critical" aria-hidden="true" />
            {error}
          </p>
        ) : null}

        {notice ? (
          <p role="status" className="rounded-xl border border-positive/25 bg-positive/[0.07] p-3 text-xs text-mist-200">
            {notice}
          </p>
        ) : null}

        <Button type="submit" variant="primary" loading={loading} className="w-full">
          {titles[mode].cta}
        </Button>
      </form>

      <p className="mt-5 text-center text-xs text-mist-400">
        {mode === 'login' ? (
          <>
            New to VozInbox?{' '}
            <Link href="/signup" className="text-violet-300 hover:text-violet-200">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <Link href="/login" className="text-violet-300 hover:text-violet-200">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
