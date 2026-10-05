import 'server-only';

import { isLocalModeEnabled } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { createAdminClient, hasAdminClient } from '@/lib/supabase/admin';
import { createServerSupabase, isSupabaseConfigured } from '@/lib/supabase/server';
import { LocalStore } from './local-store';
import { SupabaseStore } from './supabase-store';
import type { Store } from './types';

let localStore: LocalStore | null = null;

/**
 * Resolve the store for the current environment.
 *
 * Preference order:
 *  1. Local development store — only when Supabase is unconfigured and we are
 *     not in production.
 *  2. Service-role Supabase client — for background work (sync, agent runs) that
 *     has no user session. Every query is still scoped by `user_id`.
 *  3. User-scoped Supabase client — RLS applies as a second layer.
 */
export async function getStore(): Promise<Store> {
  if (isLocalModeEnabled()) {
    localStore ??= new LocalStore();
    return localStore;
  }

  if (hasAdminClient()) {
    return new SupabaseStore(createAdminClient());
  }

  const client = await createServerSupabase();
  if (client) return new SupabaseStore(client);

  throw new AppError('NOT_CONFIGURED', {
    message: 'No data store available',
    userMessage:
      'VozInbox is not connected to a database yet. Add your Supabase credentials to get started.',
  });
}

/** True when the local development store is active (surfaced in the UI). */
export function usingLocalStore(): boolean {
  return isLocalModeEnabled() && !isSupabaseConfigured();
}

export function getLocalStore(): LocalStore {
  localStore ??= new LocalStore();
  return localStore;
}

export type { Store };
export * from './types';
