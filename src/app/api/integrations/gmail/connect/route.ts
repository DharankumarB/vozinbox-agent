import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { enforceRateLimit, clientIdentifier } from '@/lib/rate-limit';
import { buildGoogleAuthUrl, isGmailConfigured } from '@/lib/integrations/gmail';
import { issueOAuthState } from '@/lib/integrations/oauth-state';
import { isEncryptionConfigured } from '@/lib/crypto';
import { logger } from '@/lib/logger';

/**
 * Starts the Gmail OAuth flow (§24).
 * The user is redirected to Google with a signed, single-use state parameter.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const auth = await getAuthContext();
    if (!auth) {
      return NextResponse.redirect(new URL('/login?next=/integrations', new URL(request.url).origin));
    }
    enforceRateLimit('oauthStart', clientIdentifier(request.headers, auth.id));

    if (!isGmailConfigured() || !isEncryptionConfigured()) {
      throw new AppError('NOT_CONFIGURED', {
        message: 'Gmail OAuth is not configured',
        userMessage:
          'Gmail cannot be connected on this deployment. Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY first.',
      });
    }

    const state = await issueOAuthState(auth.id, 'gmail');
    const url = buildGoogleAuthUrl(state, { loginHint: auth.email ?? undefined });
    logger.info('integration.gmail_oauth_started', { userId: auth.id });

    return NextResponse.redirect(url);
  } catch (error) {
    return jsonError(error);
  }
}

export const runtime = 'nodejs';
