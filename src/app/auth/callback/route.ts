import { NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

function safeNextPath(value: string | null, origin: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/dashboard';
  }

  try {
    const target = new URL(value, origin);
    if (target.origin !== origin) return '/dashboard';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/dashboard';
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const target = safeNextPath(url.searchParams.get('next'), url.origin);
  const code = url.searchParams.get('code');
  const providerError = url.searchParams.get('error');

  if (providerError || !code) {
    if (providerError && providerError !== 'access_denied') {
      logger.warn('auth.google_oauth_denied', { error: providerError });
    }
    return NextResponse.redirect(new URL('/login?oauthError=google', url.origin));
  }

  try {
    const supabase = await createServerSupabase();
    if (!supabase) {
      logger.error('auth.google_oauth_unavailable', { reason: 'Supabase is not configured' });
      return NextResponse.redirect(new URL('/login?oauthError=google', url.origin));
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logger.warn('auth.google_oauth_exchange_failed', { error: error.message });
      return NextResponse.redirect(new URL('/login?oauthError=google', url.origin));
    }

    return NextResponse.redirect(new URL(target, url.origin));
  } catch (error) {
    logger.error('auth.google_oauth_callback_failed', {
      error: error instanceof Error ? error.message : 'Unknown OAuth callback error',
    });
    return NextResponse.redirect(new URL('/login?oauthError=google', url.origin));
  }
}
