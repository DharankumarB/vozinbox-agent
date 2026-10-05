'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  Info,
  ListChecks,
  PlugZap,
  Trash2,
} from 'lucide-react';
import type { AppNotification } from '@/lib/types/database';
import type { NotificationType } from '@/lib/types/domain';
import { NOTIFICATION_TYPE_LABELS } from '@/lib/types/domain';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';
import { PriorityBadge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { NOTIFICATION_ICON_GROUP, cn, relativeTime } from '@/lib/utils';

const GROUP_ICON = {
  alert: AlertTriangle,
  deadline: CalendarClock,
  task: ListChecks,
  info: Info,
  integration: PlugZap,
} as const;

const GROUP_TONE = {
  alert: 'border-critical/25 bg-critical/10 text-critical',
  deadline: 'border-high/25 bg-high/10 text-high',
  task: 'border-violet-400/25 bg-violet-500/10 text-violet-200',
  info: 'border-white/[0.08] bg-white/[0.04] text-mist-300',
  integration: 'border-electric-400/25 bg-electric-500/10 text-electric-300',
} as const;

export function NotificationsView({ notifications }: { notifications: AppNotification[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');

  const visible = filter === 'UNREAD' ? notifications.filter((item) => !item.is_read) : notifications;
  const unreadCount = notifications.filter((item) => !item.is_read).length;

  const markRead = async (id: string, read: boolean) => {
    setBusy(id);
    try {
      const response = await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ read }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        toast.push(payload.error?.message ?? 'Unable to update this notification.', 'error');
        return;
      }
      router.refresh();
    } catch {
      toast.push('Unable to complete this action. Please try again.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const markAll = async () => {
    setBusy('all');
    try {
      const response = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        toast.push(payload.error?.message ?? 'Unable to update notifications.', 'error');
        return;
      }
      toast.push('All notifications marked as read.', 'success');
      router.refresh();
    } catch {
      toast.push('Unable to complete this action. Please try again.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      const response = await fetch(`/api/notifications/${id}`, { method: 'DELETE' });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        toast.push(payload.error?.message ?? 'Unable to delete this notification.', 'error');
        return;
      }
      router.refresh();
    } catch {
      toast.push('Unable to complete this action. Please try again.', 'error');
    } finally {
      setBusy(null);
    }
  };

  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="h-5 w-5" aria-hidden="true" />}
        title="You're all caught up."
        description="Notifications about important email, deadlines, task suggestions and integration issues will appear here."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5" role="tablist" aria-label="Filter notifications">
          {(['ALL', 'UNREAD'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                'chip',
                filter === value
                  ? 'border-violet-400/35 bg-violet-500/15 text-violet-100'
                  : 'chip-neutral hover:text-mist-100',
              )}
            >
              {value === 'ALL' ? 'All' : `Unread (${unreadCount})`}
            </button>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="sm:ml-auto"
          onClick={markAll}
          loading={busy === 'all'}
          disabled={unreadCount === 0}
        >
          <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Mark all as read
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-5 w-5" aria-hidden="true" />}
          title="Nothing unread"
          description="Every notification has been read. Switch back to “All” to review the history."
        />
      ) : (
        <ul className="space-y-2.5">
          {visible.map((notification) => {
            const group = NOTIFICATION_ICON_GROUP[notification.type as NotificationType] ?? 'info';
            const Icon = GROUP_ICON[group];
            return (
              <li
                key={notification.id}
                className={cn('panel p-4', !notification.is_read && 'border-violet-400/20 bg-violet-500/[0.04]')}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                      GROUP_TONE[group],
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p
                        className={cn(
                          'text-sm',
                          notification.is_read ? 'font-medium text-mist-300' : 'font-semibold text-mist-50',
                        )}
                      >
                        {notification.title}
                      </p>
                      <time dateTime={notification.created_at} className="shrink-0 text-[11px] text-mist-500">
                        {relativeTime(notification.created_at)}
                      </time>
                    </div>

                    {notification.message ? (
                      <p className="mt-1 break-anywhere text-xs leading-relaxed text-mist-400">
                        {notification.message}
                      </p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="chip chip-neutral">
                        <BellRing className="h-3 w-3" aria-hidden="true" />
                        {NOTIFICATION_TYPE_LABELS[notification.type as NotificationType] ?? notification.type}
                      </span>
                      {notification.priority !== 'NONE' ? <PriorityBadge priority={notification.priority} /> : null}
                      {notification.action_url ? (
                        <Link
                          href={notification.action_url}
                          className="chip border-violet-400/25 bg-violet-500/10 text-violet-200 hover:bg-violet-500/20"
                        >
                          Open
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => markRead(notification.id, !notification.is_read)}
                      loading={busy === notification.id}
                      aria-label={notification.is_read ? 'Mark as unread' : 'Mark as read'}
                    >
                      {notification.is_read ? (
                        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => remove(notification.id)}
                      loading={busy === notification.id}
                      aria-label="Delete notification"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-critical" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
