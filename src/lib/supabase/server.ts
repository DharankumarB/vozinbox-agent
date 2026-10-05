import 'server-only';

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { publicEnv } from '@/lib/env';

/**
 * Server-side Supabase client bound to the request's auth cookies.
 *
 * Uses the anon key: every query is subject to RLS and can only ever reach the
 * signed-in user's rows (§31). Server Components cannot write cookies, so
 * failures to persist a refreshed token are ignored here — the middleware is
 * responsible for session refresh.
 */
export async function createServerSupabase(): Promise<SupabaseClient | null> {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  if (!supabaseUrl || !supabaseAnonKey) return null;

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]);
          }
        } catch {
          // Called from a Server Component — the middleware refreshes instead.
        }
      },
    },
  });
}

export function isSupabaseConfigured(): boolean {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  return Boolean(supabaseUrl && supabaseAnonKey);
}
