import 'server-only';

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { AppError } from '@/lib/errors';
import { tokenEncryptionKey } from '@/lib/env';

/**
 * OAuth `state` handling (§24).
 *
 * Two independent protections against CSRF / authorisation-code injection:
 *  1. the state value is a signed, expiring, single-purpose token; and
 *  2. it is also stored in a short-lived HttpOnly cookie and compared on return.
 */

const COOKIE_NAME = 'vozinbox_oauth_state';
const TTL_SECONDS = 600;

function secret(): string {
  const key = tokenEncryptionKey();
  if (key) return `oauth:${key}`;
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('NOT_CONFIGURED', {
      message: 'TOKEN_ENCRYPTION_KEY is required for OAuth in production',
    });
  }
  return 'oauth:development-only-insecure-secret';
}

interface StatePayload {
  userId: string;
  provider: string;
  nonce: string;
  exp: number;
}

export async function issueOAuthState(userId: string, provider: string): Promise<string> {
  const payload: StatePayload = {
    userId,
    provider,
    nonce: randomBytes(16).toString('base64url'),
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret()).update(encoded).digest('base64url');
  const state = `${encoded}.${signature}`;

  const store = await cookies();
  store.set(COOKIE_NAME, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_SECONDS,
  });

  return state;
}

export async function verifyOAuthState(state: string | null, expectedProvider: string): Promise<string> {
  const store = await cookies();
  const cookieState = store.get(COOKIE_NAME)?.value ?? null;
  store.set(COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 });

  if (!state || !cookieState) {
    throw new AppError('OAUTH_FAILED', {
      message: 'OAuth state missing from request or cookie',
      userMessage: 'The connection request expired or was tampered with. Please start the connection again.',
    });
  }

  const cookieBuffer = Buffer.from(cookieState);
  const stateBuffer = Buffer.from(state);
  if (cookieBuffer.length !== stateBuffer.length || !timingSafeEqual(cookieBuffer, stateBuffer)) {
    throw new AppError('OAUTH_FAILED', {
      message: 'OAuth state cookie mismatch',
      userMessage: 'The connection request could not be verified. Please start the connection again.',
    });
  }

  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) {
    throw new AppError('OAUTH_FAILED', { message: 'Malformed OAuth state' });
  }

  const expected = createHmac('sha256', secret()).update(encoded).digest('base64url');
  const given = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (given.length !== expectedBuffer.length || !timingSafeEqual(given, expectedBuffer)) {
    throw new AppError('OAUTH_FAILED', {
      message: 'OAuth state signature invalid',
      userMessage: 'The connection request could not be verified. Please start the connection again.',
    });
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as StatePayload;
  } catch {
    throw new AppError('OAUTH_FAILED', { message: 'OAuth state payload unreadable' });
  }

  if (payload.exp * 1000 < Date.now()) {
    throw new AppError('OAUTH_FAILED', {
      message: 'OAuth state expired',
      userMessage: 'The connection request expired. Please start the connection again.',
    });
  }
  if (payload.provider !== expectedProvider) {
    throw new AppError('OAUTH_FAILED', {
      message: `OAuth state provider mismatch: ${payload.provider} !== ${expectedProvider}`,
    });
  }

  return payload.userId;
}
