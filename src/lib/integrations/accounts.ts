import 'server-only';

import { AppError, toAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { decryptSecret, encryptSecret, isEncryptionConfigured } from '@/lib/crypto';
import type { EmailAccount } from '@/lib/types/database';
import type { Store } from '@/lib/store/types';
import {
  exchangeCodeForTokens,
  getGmailProfile,
  getGoogleUserInfo,
  GMAIL_SCOPES,
  isGmailConfigured,
  refreshAccessToken,
  revokeToken,
} from './gmail';

/**
 * Mailbox connection lifecycle (§24, §25, §32).
 *
 * Tokens are encrypted before storage and decrypted only here, on the server.
 * Refresh happens lazily with a safety margin; a revoked grant marks the account
 * as ERROR and raises an integration event so the user sees a reconnect prompt
 * instead of silent failure.
 */

const EXPIRY_MARGIN_MS = 90_000;

export interface ConnectResult {
  account: EmailAccount;
  created: boolean;
}

export function isGmailReady(): boolean {
  return isGmailConfigured() && isEncryptionConfigured();
}

export async function connectGmail(input: {
  store: Store;
  userId: string;
  code: string;
}): Promise<ConnectResult> {
  const { store, userId, code } = input;
  if (!isGmailReady()) {
    throw new AppError('NOT_CONFIGURED', {
      message: 'Gmail connection is not configured',
      userMessage:
        'Gmail cannot be connected on this deployment yet. An administrator needs to configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY.',
    });
  }

  const tokens = await exchangeCodeForTokens(code);
  if (!tokens.refresh_token) {
    throw new AppError('OAUTH_FAILED', {
      message: 'Google did not return a refresh token',
      userMessage:
        'Google did not grant long-lived access. Please try connecting again and approve all requested permissions.',
    });
  }

  const accessToken = tokens.access_token;
  if (!accessToken) {
    throw new AppError('OAUTH_FAILED', { message: 'Google did not return an access token' });
  }

  const profile = await getGmailProfile(accessToken);
  const identity = await getGoogleUserInfo(accessToken);
  const providerAccountId = identity.sub ?? profile.providerAccountId;

  const account = await store.createAccount({
    user_id: userId,
    provider: 'gmail',
    provider_account_id: providerAccountId,
    email_address: profile.emailAddress,
    display_name: identity.name,
    scopes: tokens.scope ? tokens.scope.split(' ').filter(Boolean) : [...GMAIL_SCOPES],
    status: 'CONNECTED',
  });

  await store.saveCredentials({
    account_id: account.id,
    user_id: userId,
    refresh_token_cipher: encryptSecret(tokens.refresh_token),
    access_token_cipher: tokens.access_token ? encryptSecret(tokens.access_token) : null,
    scope: tokens.scope,
    expires_at: tokens.expires_at,
    token_type: tokens.token_type,
  });

  await store.resolveIntegrationEvents(userId, account.id);
  await store.logIntegrationEvent({
    user_id: userId,
    account_id: account.id,
    provider: 'gmail',
    event_type: 'CONNECTED',
    severity: 'info',
    message: `Gmail connected for ${profile.emailAddress}.`,
    context: { scopes: tokens.scope },
  });
  await store.createNotification({
    user_id: userId,
    type: 'INTEGRATION_CONNECTED',
    title: 'Gmail connected',
    message: `${profile.emailAddress} is now connected. Your inbox will be analysed automatically.`,
    priority: 'NONE',
    entity_type: 'integration',
    related_entity_id: account.id,
    action_url: '/inbox',
    metadata: { email_address: profile.emailAddress },
    dedupe_key: `gmail-connected:${account.id}`,
  });

  logger.info('integration.gmail_connected', { userId, accountId: account.id });

  return { account, created: true };
}

/**
 * Return a usable access token, refreshing when close to expiry.
 * The refreshed token is persisted so subsequent calls skip the round trip.
 */
export async function getAccessToken(store: Store, userId: string, account: EmailAccount): Promise<string> {
  const credentials = await store.getCredentials(userId, account.id);
  if (!credentials) {
    throw new AppError('TOKEN_EXPIRED', {
      message: 'No stored credentials for account',
      userMessage: 'This mailbox needs to be reconnected before it can be synced.',
    });
  }

  const expiresAt = credentials.expires_at ? Date.parse(credentials.expires_at) : 0;
  const stillValid = credentials.access_token_cipher && expiresAt - EXPIRY_MARGIN_MS > Date.now();

  if (stillValid && credentials.access_token_cipher) {
    try {
      return decryptSecret(credentials.access_token_cipher);
    } catch {
      // Fall through to a refresh when the cached token cannot be decrypted.
    }
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(credentials.refresh_token_cipher);
  } catch (error) {
    await markAccountError(store, userId, account, 'Stored credentials could not be decrypted.');
    throw error;
  }

  try {
    const refreshed = await refreshAccessToken(refreshToken);
    await store.saveCredentials({
      account_id: account.id,
      user_id: userId,
      refresh_token_cipher: credentials.refresh_token_cipher,
      access_token_cipher: refreshed.access_token ? encryptSecret(refreshed.access_token) : null,
      scope: refreshed.scope ?? credentials.scope,
      expires_at: refreshed.expires_at,
      token_type: refreshed.token_type,
    });
    if (!refreshed.access_token) {
      throw new AppError('TOKEN_EXPIRED', { message: 'Refresh returned no access token' });
    }
    return refreshed.access_token;
  } catch (error) {
    const appError = toAppError(error, 'OAUTH_FAILED');
    if (appError.code === 'TOKEN_REVOKED' || appError.code === 'OAUTH_FAILED') {
      await markAccountError(
        store,
        userId,
        account,
        appError.code === 'TOKEN_REVOKED'
          ? 'Google revoked access. Reconnect to continue syncing.'
          : 'Token refresh failed. Reconnect to continue syncing.',
      );
    }
    throw appError;
  }
}

async function markAccountError(store: Store, userId: string, account: EmailAccount, message: string): Promise<void> {
  try {
    await store.updateAccount(userId, account.id, {
      status: 'ERROR',
      last_sync_status: 'ERROR',
      last_sync_error: message,
    });
    await store.logIntegrationEvent({
      user_id: userId,
      account_id: account.id,
      provider: account.provider,
      event_type: 'TOKEN_ERROR',
      severity: 'error',
      message,
      context: {},
    });
    await store.createNotification({
      user_id: userId,
      type: 'INTEGRATION_ISSUE',
      title: 'Email connection needs attention',
      message: `${account.email_address}: ${message}`,
      priority: 'HIGH',
      entity_type: 'integration',
      related_entity_id: account.id,
      action_url: '/integrations',
      metadata: {},
      dedupe_key: `integration-error:${account.id}:${message.slice(0, 40)}`,
    });
  } catch (error) {
    logger.error('integration.mark_error_failed', { accountId: account.id, detail: toAppError(error).message });
  }
}

export async function disconnectGmail(input: {
  store: Store;
  userId: string;
  accountId: string;
  revoke?: boolean;
}): Promise<void> {
  const { store, userId, accountId } = input;
  const account = await store.getAccount(userId, accountId);
  if (!account) {
    throw new AppError('NOT_FOUND', { message: 'Account not found', userMessage: 'That mailbox is not connected.' });
  }

  if (input.revoke !== false) {
    const credentials = await store.getCredentials(userId, accountId);
    if (credentials) {
      try {
        await revokeToken(decryptSecret(credentials.refresh_token_cipher));
      } catch (error) {
        logger.warn('integration.revoke_skipped', {
          accountId,
          detail: toAppError(error).message,
        });
      }
    }
  }

  await store.deleteCredentials(userId, accountId);
  await store.updateAccount(userId, accountId, {
    status: 'DISCONNECTED',
    disconnected_at: new Date().toISOString(),
    last_sync_status: null,
    last_sync_error: null,
    last_history_id: null,
  });
  await store.logIntegrationEvent({
    user_id: userId,
    account_id: accountId,
    provider: account.provider,
    event_type: 'DISCONNECTED',
    severity: 'info',
    message: 'Mailbox disconnected and stored credentials deleted.',
    context: {},
  });

  logger.info('integration.gmail_disconnected', { userId, accountId });
}

/** Connection health for the integrations page. */
export interface AccountHealth {
  account: EmailAccount;
  hasCredentials: boolean;
  connected: boolean;
  lastSyncLabel: string | null;
  needsAttention: boolean;
}

export async function listAccountHealth(store: Store, userId: string): Promise<AccountHealth[]> {
  const accounts = await store.listAccounts(userId);
  const health: AccountHealth[] = [];

  for (const account of accounts) {
    const credentials = await store.getCredentials(userId, account.id);
    health.push({
      account,
      hasCredentials: Boolean(credentials),
      connected: account.status === 'CONNECTED' && Boolean(credentials),
      lastSyncLabel: account.last_sync_at ?? null,
      needsAttention: account.status === 'ERROR' || account.status === 'REVOKED' || !credentials,
    });
  }

  return health;
}
