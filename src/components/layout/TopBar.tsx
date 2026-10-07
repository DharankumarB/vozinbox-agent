'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { LogOut, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { NotificationBell } from './NotificationBell';
import { Logo } from './Logo';
import { relativeTime } from '@/lib/utils';

export function TopBar({
  email,
  lastSyncAt,
  unreadNotifications,
}: {
  email: string | null;
  lastSyncAt: string | null;
  unreadNotifications: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [pending, startTransition] = useTransition();

  const handleSync = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/integrations/gmail/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as
        | { ok: true; data: { summaries: Array<{ status: string; message: string; analyzed: number }> } }
        | { ok: false; error: { message: string } };

      if (!payload.ok) {
        toast.push(payload.error.message, 'error');
        return;
      }
      const summary = payload.data.summaries[0];
      if (!summary) {
        toast.push('No mailbox is connected yet.', 'info');
        return;
      }
      toast.push(summary.message, summary.status === 'FAILED' ? 'error' : 'success');
      startTransition(() => router.refresh());
    } catch {
      toast.push('Unable to reach the sync service. Please try again.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/85 backdrop-blur-md">
      <div className="flex items-center gap-3 px-4 py-3 lg:px-6">
        <Logo compact className="lg:hidden" />

        <div className="hidden min-w-0 flex-1 items-center gap-3 lg:flex">
          <Link
            href="/search"
            className="group flex w-full max-w-md items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-mist-500 transition-colors hover:border-white/[0.14] hover:text-mist-300"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            <span>Search your inbox intelligence…</span>
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <span className="hidden text-[11px] text-mist-500 md:block">
            {lastSyncAt ? `Last synced ${relativeTime(lastSyncAt)}` : 'Not synced yet'}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSync}
            loading={syncing || pending}
            aria-label="Sync now"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Sync now</span>
          </Button>
          <NotificationBell unreadCount={unreadNotifications} />
          <Button variant="ghost" size="sm" onClick={handleLogout} aria-label={`Sign out ${email ?? ''}`}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </header>
  );
}
