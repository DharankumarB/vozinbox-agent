import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';
import { AppError } from '@/lib/errors';
import { enforceRateLimit, clientIdentifier } from '@/lib/rate-limit';
import { buildGoogleAuthUrl, isGmailConfigured } from '@/lib/integrations/gmail';
import { issueOAuthState } from '@/lib/integrations/oauth-state';
import { encryptSecret, isEncryptionConfigured } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { isLocalModeEnabled } from '@/lib/env';
import { getStore } from '@/lib/store';

/**
 * Starts the Gmail OAuth flow (§24).
 * The user is redirected to Google with a signed, single-use state parameter.
 * In local mode without Google OAuth keys, it connects the Gmail address in local store.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const auth = await getAuthContext();
    if (!auth) {
      return NextResponse.redirect(new URL('/login?next=/integrations', new URL(request.url).origin));
    }
    enforceRateLimit('oauthStart', clientIdentifier(request.headers, auth.id));

    if (isGmailConfigured() && isEncryptionConfigured()) {
      const state = await issueOAuthState(auth.id, 'gmail');
      const url = buildGoogleAuthUrl(state, { loginHint: auth.email ?? undefined });
      logger.info('integration.gmail_oauth_started', { userId: auth.id });
      return NextResponse.redirect(url);
    }

    if (isLocalModeEnabled()) {
      const targetEmail = 'demo@example.test';
      const store = await getStore();

      const account = await store.createAccount({
        user_id: auth.id,
        provider: 'gmail',
        provider_account_id: targetEmail.toLowerCase(),
        email_address: targetEmail,
        display_name: auth.fullName ?? 'Demo User',
        scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        status: 'CONNECTED',
      });

      if (isEncryptionConfigured()) {
        await store.saveCredentials({
          account_id: account.id,
          user_id: auth.id,
          refresh_token_cipher: encryptSecret('mock_refresh_token'),
          access_token_cipher: encryptSecret('mock_access_token'),
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          expires_at: new Date(Date.now() + 3600 * 1000 * 24 * 365).toISOString(),
          token_type: 'Bearer',
        });
      }

      await store.resolveIntegrationEvents(auth.id, account.id);
      await store.logIntegrationEvent({
        user_id: auth.id,
        account_id: account.id,
        provider: 'gmail',
        event_type: 'CONNECTED',
        severity: 'info',
        message: `Gmail connected for ${targetEmail}.`,
        context: {},
      });
      await store.createNotification({
        user_id: auth.id,
        type: 'INTEGRATION_CONNECTED',
        title: 'Gmail connected',
        message: `${targetEmail} is now connected.`,
        priority: 'NONE',
        entity_type: 'integration',
        related_entity_id: account.id,
        action_url: '/inbox',
        metadata: { email_address: targetEmail },
        dedupe_key: `gmail-connected:${account.id}`,
      });

      const redirectUrl = new URL('/integrations', request.url);
      redirectUrl.searchParams.set('status', 'connected');
      redirectUrl.searchParams.set('message', `${targetEmail} connected.`);
      return NextResponse.redirect(redirectUrl);
    }

    throw new AppError('NOT_CONFIGURED', {
      message: 'Gmail OAuth is not configured',
      userMessage:
        'Gmail cannot be connected on this deployment. Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY first.',
    });
  } catch (error) {
    return jsonError(error);
  }
}

export const runtime = 'nodejs';
