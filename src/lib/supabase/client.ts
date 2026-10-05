'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';

/**
 * Browser Supabase client — used for auth flows initiated in the UI and for
 * Realtime subscriptions. Only the anon key is ever present here (§31).
 */
export function createClient(): SupabaseClient | null {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  if (!supabaseUrl || !supabaseAnonKey) return null;
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

export function isSupabaseConfigured(): boolean {
  const { supabaseUrl, supabaseAnonKey } = publicEnv();
  return Boolean(supabaseUrl && supabaseAnonKey);
}
