import 'server-only';

import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { publicEnv, tokenEncryptionKey } from '@/lib/env';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

export const SESSION_COOKIE = 'vozinbox_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Session handling for the local development store.
 *
 * Supabase auth is used whenever a project is configured; this module provides
 * the equivalent primitive (signed, HttpOnly cookie) so the product is fully
 * usable without external accounts in development.
 */

function sessionSecret(): string {
  const secret = tokenEncryptionKey();
  if (secret) return `session:${secret}`;
  // Development-only fallback. Local mode never runs in production, and
  // production deployments are rejected without TOKEN_ENCRYPTION_KEY.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('TOKEN_ENCRYPTION_KEY is required in production');
  }
  return 'session:development-only-insecure-secret';
}

interface SessionPayload {
  sub: string;
  email: string;
  exp: number;
}

function sign(value: string): string {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

export function createSessionToken(userId: string, email: string): string {
  const payload: SessionPayload = {
    sub: userId,
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${sign(encoded)}`;
}

export function readSessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const givenBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (givenBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(givenBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string, email: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(userId, email), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
}

export async function readSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return readSessionToken(store.get(SESSION_COOKIE)?.value);
}

// ── Password hashing (local mode) ────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('base64')}:${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltPart, hashPart] = stored.split(':');
  if (scheme !== 'scrypt' || !saltPart || !hashPart) return false;
  const derived = await scrypt(password, Buffer.from(saltPart, 'base64'), 64);
  const expected = Buffer.from(hashPart, 'base64');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

export function appUrl(): string {
  return publicEnv().appUrl;
}
