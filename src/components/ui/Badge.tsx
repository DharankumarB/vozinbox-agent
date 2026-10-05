import type { ReactNode } from 'react';
import { AlertTriangle, CalendarClock, Paperclip, Sparkles } from 'lucide-react';
import type { EmailCategory, EmailPriority, TaskStatus } from '@/lib/types/domain';
import { CATEGORY_LABELS } from '@/lib/types/domain';
import { CATEGORY_ACCENT, PRIORITY_META, TASK_STATUS_CHIP, cn, shortDate, timeLabel } from '@/lib/utils';

export function PriorityBadge({
  priority,
  withLabel = true,
  className,
}: {
  priority: EmailPriority;
  withLabel?: boolean;
  className?: string;
}) {
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cn('chip', meta.chip, className)}
      // Symbol + text so priority is not conveyed by colour alone (§40).
      title={`Priority: ${meta.label}`}
    >
      <span aria-hidden="true" className="font-mono text-[9px] leading-none">
        {meta.symbol}
      </span>
      {withLabel ? <span>{meta.label}</span> : null}
      <span className="sr-only">Priority {meta.label}</span>
    </span>
  );
}

export function CategoryBadge({
  category,
  secondary,
  className,
}: {
  category: EmailCategory;
  secondary?: EmailCategory[];
  className?: string;
}) {
  return (
    <span className={cn('chip', CATEGORY_ACCENT[category], className)}>
      <span>{CATEGORY_LABELS[category]}</span>
      {secondary && secondary.length > 0 ? (
        <span className="text-[10px] opacity-70">· {CATEGORY_LABELS[secondary[0]!]}</span>
      ) : null}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const labels: Record<TaskStatus, string> = {
    SUGGESTED: 'AI suggested',
    TODO: 'To do',
    IN_PROGRESS: 'In progress',
    COMPLETED: 'Completed',
    DISMISSED: 'Dismissed',
  };
  return (
    <span className={cn('chip', TASK_STATUS_CHIP[status], className)}>
      {status === 'SUGGESTED' ? <Sparkles className="h-3 w-3" aria-hidden="true" /> : null}
      {labels[status]}
    </span>
  );
}

export function DeadlineBadge({
  date,
  time,
  confidence,
  className,
  tone = 'default',
}: {
  date: string | null;
  time: string | null;
  confidence?: number;
  className?: string;
  tone?: 'default' | 'warning' | 'muted';
}) {
  if (!date) return null;
  const label = timeLabel(time);
  const toneClass =
    tone === 'warning'
      ? 'border-high/35 bg-high/10 text-high'
      : tone === 'muted'
        ? 'border-white/[0.08] bg-white/[0.03] text-mist-400'
        : 'border-white/[0.1] bg-white/[0.05] text-mist-200';

  return (
    <span className={cn('chip', toneClass, className)} title={confidence === undefined ? undefined : `Detected with ${Math.round(confidence * 100)}% confidence`}>
      <CalendarClock className="h-3 w-3" aria-hidden="true" />
      {shortDate(date)}
      {label ? ` · ${label}` : ''}
      {confidence !== undefined && confidence < 0.7 ? (
        <span className="text-[10px] opacity-80" title="Low confidence — please verify">
          ?
        </span>
      ) : null}
    </span>
  );
}

export function AttachmentBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cn('chip chip-neutral', className)}>
      <Paperclip className="h-3 w-3" aria-hidden="true" />
      {count} attachment{count === 1 ? '' : 's'}
    </span>
  );
}

export function ReviewBadge({ reason, className }: { reason?: string | null; className?: string }) {
  return (
    <span className={cn('chip border-medium/35 bg-medium/10 text-medium', className)} title={reason ?? undefined}>
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      Needs review
    </span>
  );
}

export function Chip({
  children,
  className,
  tone = 'neutral',
}: {
  children: ReactNode;
  className?: string;
  tone?: 'neutral' | 'accent';
}) {
  return (
    <span
      className={cn(
        'chip',
        tone === 'accent' ? 'border-violet-400/30 bg-violet-500/12 text-violet-200' : 'chip-neutral',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function UnreadDot({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="flex h-2 w-2 shrink-0 items-center justify-center" aria-label="Unread">
      <span className="h-2 w-2 rounded-full bg-violet-400 animate-pulse-ring" />
    </span>
  );
}
