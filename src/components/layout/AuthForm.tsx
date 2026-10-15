'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { AlertCircle } from 'lucide-react';
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client';

type Mode = 'login' | 'signup' | 'reset';

export function AuthForm({
  mode,
  nextPath = '/dashboard',
  googleError = false,
}: {
  mode: Mode;
  nextPath?: string;
  googleError?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    googleError ? 'Google sign-in could not be completed. Please try again.' : null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  const onGoogleSignIn = async () => {
    setError(null);
    setOauthLoading(true);

    try {
      const supabase = createClient();
      if (!supabase) {
        setError('Google sign-in is unavailable because authentication is not configured.');
        return;
      }

      const redirectTo = new URL('/auth/callback', window.location.origin);
      redirectTo.searchParams.set('next', nextPath);
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectTo.toString() },
      });

      if (oauthError) {
        setError('Unable to start Google sign-in. Please try again.');
      }
    } catch {
      setError('Unable to start Google sign-in. Please try again.');
    } finally {
      setOauthLoading(false);
    }
  };

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

        <Button type="submit" variant="primary" loading={loading} disabled={oauthLoading} className="w-full">
          {titles[mode].cta}
        </Button>
      </form>

      {mode !== 'reset' && isSupabaseConfigured() ? (
        <>
          <div className="my-4 flex items-center gap-3 text-[11px] text-mist-500" aria-hidden="true">
            <span className="h-px flex-1 bg-white/10" />
            <span>or</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
          <Button
            type="button"
            variant="secondary"
            loading={oauthLoading}
            disabled={loading}
            onClick={onGoogleSignIn}
            className="w-full"
          >
            <svg className="h-4 w-4" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.74 7.18l7.72 5.99c4.51-4.16 7.06-10.28 7.06-17.64Z" />
              <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.75-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.88.93 7.57 2.56 10.78l7.97-6.19Z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.81l-7.72-5.99c-2.14 1.44-4.89 2.3-8.19 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
            </svg>
            Continue with Google
          </Button>
        </>
      ) : null}

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
