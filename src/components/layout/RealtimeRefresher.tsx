'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Real-time experience (§27).
 *
 * Subscribes to the user's own rows via Supabase Realtime and refreshes the
 * server-rendered dashboard when something changes, so counts update without a
 * manual reload. When Supabase is not configured (local mode) this is a no-op —
 * the UI stays correct, just without push updates.
 */
export function RealtimeRefresher({ userId }: { userId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;

    let timeout: number | null = null;
    const scheduleRefresh = () => {
      if (timeout !== null) window.clearTimeout(timeout);
      // Coalesce bursts (a sync can emit many rows at once).
      timeout = window.setTimeout(() => router.refresh(), 900);
    };

    const channel = supabase
      .channel(`vozinbox:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emails', filter: `user_id=eq.${userId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_analysis', filter: `user_id=eq.${userId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, scheduleRefresh)
      .subscribe();

    return () => {
      if (timeout !== null) window.clearTimeout(timeout);
      void supabase.removeChannel(channel);
    };
  }, [router, userId]);

  return null;
}
