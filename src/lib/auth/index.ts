import 'server-only';

import { redirect } from 'next/navigation';
import { AppError, toAppError } from '@/lib/errors';
import { publicEnv } from '@/lib/env';
import { createServerSupabase } from '@/lib/supabase/server';
import { isLocalModeEnabled } from '@/lib/env';
import { getLocalStore } from '@/lib/store';
import type { Profile, UserPreferences } from '@/lib/types/database';
import {
  clearSessionCookie,
  hashPassword,
  readSession,
  setSessionCookie,
  verifyPassword,
} from './session';

/**
 * Authentication facade (§5).
 *
 * Supabase Auth is the production path (email + password, session persistence,
 * password reset, protected routes). When Supabase is not configured the app
 * runs against the local development store with equivalent semantics so every
 * feature can be exercised end to end.
 */

export interface AuthUser {
  id: string;
  email: string | null;
  fullName: string | null;
  timezone: string;
  source: 'supabase' | 'local';
}

export interface AuthContext extends AuthUser {
  profile: Profile;
  preferences: UserPreferences;
}

function localMode(): boolean {
  return isLocalModeEnabled() && (!publicEnv().supabaseUrl || !publicEnv().supabaseAnonKey);
}

// ── Session resolution ───────────────────────────────────────────────────────

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (!localMode()) {
    const supabase = await createServerSupabase();
    if (!supabase) return null;
    try {
      // `getClaims` verifies the JWT signature; `getUser` reads the fresh record.
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
      if (claimsError || !claimsData?.claims) return null;
      const userId = claimsData.claims.sub;
      if (!userId) return null;

      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        return {
          id: userId,
          email: typeof claimsData.claims.email === 'string' ? claimsData.claims.email : null,
          fullName: null,
          timezone: 'UTC',
          source: 'supabase',
        };
      }
      const store = getLocalStoreOrNull();
      void store;
      return {
        id: user.id,
        email: user.email ?? null,
        fullName:
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          null,
        timezone: (user.user_metadata?.timezone as string | undefined) ?? 'UTC',
        source: 'supabase',
      };
    } catch {
      return null;
    }
  }

  const session = await readSession();
  if (!session) return null;
  const local = getLocalStore();
  const user = await local.getUserById(session.sub);
  if (!user) {
    await clearSessionCookie();
    return null;
  }
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    timezone: user.timezone,
    source: 'local',
  };
}

function getLocalStoreOrNull() {
  try {
    return getLocalStore();
  } catch {
    return null;
  }
}

/** Ensure profile + preferences exist, then return the full context. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const store = await getStoreSafe();
  const { profile, preferences } = await store.ensureBootstrap({
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    timezone: user.timezone,
  });

  return { ...user, profile, preferences };
}

async function getStoreSafe() {
  const { getStore } = await import('@/lib/store');
  return getStore();
}

/** Throws for API routes / server actions. */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AppError('UNAUTHENTICATED');
  }
  return user;
}

/** Redirects for pages. */
export async function requireAuthContext(redirectTo = '/login'): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) redirect(redirectTo);
  return context;
}

// ── Credential flows ─────────────────────────────────────────────────────────

export interface AuthResult {
  user: AuthUser | null;
  /** True when Supabase requires email confirmation before a session exists. */
  requiresEmailConfirmation: boolean;
}

export async function signUp(input: {
  email: string;
  password: string;
  fullName: string | null;
  timezone: string;
}): Promise<AuthResult> {
  if (localMode()) {
    const store = getLocalStore();
    const passwordHash = await hashPassword(input.password);
    const user = await store.createUser({
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      timezone: input.timezone,
    });
    await store.ensureBootstrap({
      userId: user.id,
      email: user.email,
      fullName: user.full_name,
      timezone: user.timezone,
    });
    await setSessionCookie(user.id, user.email);
    return {
      user: { id: user.id, email: user.email, fullName: user.full_name, timezone: user.timezone, source: 'local' },
      requiresEmailConfirmation: false,
    };
  }

  const supabase = await createServerSupabase();
  if (!supabase) {
    throw new AppError('NOT_CONFIGURED', {
      message: 'Supabase client unavailable',
      userMessage: 'Accounts are not configured on this deployment yet.',
    });
  }

  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { full_name: input.fullName, timezone: input.timezone },
      emailRedirectTo: `${publicEnv().appUrl}/dashboard`,
    },
  });

  if (error) {
    throw new AppError('FORBIDDEN', {
      message: `signUp failed: ${error.message}`,
      userMessage: friendlyAuthMessage(error.message, 'signup'),
      status: error.status ?? 400,
      cause: error,
    });
  }

  return {
    user: data.user
      ? {
          id: data.user.id,
          email: data.user.email ?? input.email,
          fullName: input.fullName,
          timezone: input.timezone,
          source: 'supabase',
        }
      : null,
    requiresEmailConfirmation: Boolean(data.user && !data.session),
  };
}

export async function signIn(input: { email: string; password: string }): Promise<AuthResult> {
  if (localMode()) {
    const store = getLocalStore();
    const user = await store.findUserByEmail(input.email);
    if (!user || !(await verifyPassword(input.password, user.password_hash))) {
      throw new AppError('UNAUTHENTICATED', {
        message: 'Invalid credentials',
        userMessage: 'That email and password combination does not match our records.',
      });
    }
    await setSessionCookie(user.id, user.email);
    return {
      user: { id: user.id, email: user.email, fullName: user.full_name, timezone: user.timezone, source: 'local' },
      requiresEmailConfirmation: false,
    };
  }

  const supabase = await createServerSupabase();
  if (!supabase) {
    throw new AppError('NOT_CONFIGURED', {
      userMessage: 'Sign-in is not configured on this deployment yet.',
    });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error) {
    throw new AppError('UNAUTHENTICATED', {
      message: `signIn failed: ${error.message}`,
      userMessage: friendlyAuthMessage(error.message, 'signin'),
      status: error.status ?? 401,
      cause: error,
    });
  }

  return {
    user: data.user
      ? {
          id: data.user.id,
          email: data.user.email ?? input.email,
          fullName: (data.user.user_metadata?.full_name as string | undefined) ?? null,
          timezone: (data.user.user_metadata?.timezone as string | undefined) ?? 'UTC',
          source: 'supabase',
        }
      : null,
    requiresEmailConfirmation: false,
  };
}

export async function signOut(): Promise<void> {
  if (localMode()) {
    await clearSessionCookie();
    return;
  }
  const supabase = await createServerSupabase();
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      // A failed server-side revoke must not trap the user in a signed-in shell.
      console.warn('[auth] signOut error:', toAppError(error).message);
    }
  }
  await clearSessionCookie();
}

export async function requestPasswordReset(email: string): Promise<void> {
  if (localMode()) {
    throw new AppError('NOT_CONFIGURED', {
      message: 'Password reset requires Supabase',
      userMessage:
        'Password reset emails need a Supabase project and an email provider. In local development mode, create a new account instead.',
    });
  }
  const supabase = await createServerSupabase();
  if (!supabase) throw new AppError('NOT_CONFIGURED', { userMessage: 'Password reset is not configured yet.' });
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${publicEnv().appUrl}/settings/account?reset=1`,
  });
  if (error) {
    // Never reveal whether an address exists.
    console.warn('[auth] password reset request failed:', error.message);
  }
}

export async function updatePassword(password: string): Promise<void> {
  if (localMode()) {
    const session = await readSession();
    if (!session) throw new AppError('UNAUTHENTICATED');
    const store = getLocalStore();
    await store.updateUserPassword(session.sub, await hashPassword(password));
    return;
  }
  const supabase = await createServerSupabase();
  if (!supabase) throw new AppError('NOT_CONFIGURED');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    throw new AppError('VALIDATION', {
      message: `updatePassword failed: ${error.message}`,
      userMessage: friendlyAuthMessage(error.message, 'update'),
      cause: error,
    });
  }
}

function friendlyAuthMessage(message: string, stage: 'signin' | 'signup' | 'update'): string {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return 'That email and password combination does not match our records.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Please confirm your email address first — check your inbox for the verification link.';
  }
  if (lower.includes('already registered') || lower.includes('already been registered')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (lower.includes('password should be at least')) {
    return 'Please choose a password with at least 8 characters.';
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (lower.includes('invalid email')) {
    return 'Please enter a valid email address.';
  }
  return stage === 'signup'
    ? 'We could not create your account. Please try again.'
    : 'We could not complete that request. Please try again.';
}
