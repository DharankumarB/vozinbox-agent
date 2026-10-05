import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, supabaseServiceRoleKey } from '@/lib/env';
import { AppError } from '@/lib/errors';

let cached: SupabaseClient | null = null;

/**
 * Service-role client. **Server only.**
 *
 * This client bypasses RLS, so every call site must scope queries by the
 * authenticated `user_id` explicitly. It is used for:
 *   • background sync / agent runs where no user session exists,
 *   • writes to `email_account_credentials` (tokens),
 *   • rate-limit bookkeeping and retention jobs.
 *
 * It is never imported from a Client Component and never serialised to the
 * browser (§31).
 */
export function createAdminClient(): SupabaseClient {
  if (cached) return cached;

  const { supabaseUrl } = publicEnv();
  const serviceKey = supabaseServiceRoleKey();

  if (!supabaseUrl || !serviceKey) {
    throw new AppError('NOT_CONFIGURED', {
      message: 'Supabase service role credentials are missing',
      userMessage:
        'Background processing is not configured on this deployment. Connect your database credentials to enable it.',
    });
  }

  cached = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-vozinbox-client': 'server-admin' } },
  });
  return cached;
}

export function hasAdminClient(): boolean {
  const { supabaseUrl } = publicEnv();
  return Boolean(supabaseUrl && supabaseServiceRoleKey());
}
