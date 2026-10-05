import { NextResponse } from 'next/server';
import { getStore } from '@/lib/store';
import { connectGmail } from '@/lib/integrations/accounts';
import { verifyOAuthState } from '@/lib/integrations/oauth-state';
import { toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * OAuth callback (§24, §32).
 *
 * Failures never render a stack trace: the user is redirected back to the
 * integrations page with a friendly message, and the technical detail is logged
 * server-side only.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  const redirectWith = (status: string, message?: string) => {
    const target = new URL('/integrations', origin);
    target.searchParams.set('status', status);
    if (message) target.searchParams.set('message', message.slice(0, 300));
    return NextResponse.redirect(target);
  };

  if (error) {
    logger.warn('integration.gmail_denied', { error });
    return redirectWith(
      'denied',
      error === 'access_denied'
        ? 'You declined the Gmail permissions, so nothing was connected.'
        : 'Google could not complete the authorisation.',
    );
  }

  if (!code) return redirectWith('error', 'Google did not return an authorisation code.');

  try {
    const userId = await verifyOAuthState(state, 'gmail');
    const store = await getStore();
    const { account } = await connectGmail({ store, userId, code });
    return redirectWith('connected', `${account.email_address} connected.`);
  } catch (err) {
    const appError = toAppError(err, 'OAUTH_FAILED');
    logger.error('integration.gmail_callback_failed', { code: appError.code, detail: appError.message });
    return redirectWith('error', appError.userMessage);
  }
}

export const runtime = 'nodejs';
