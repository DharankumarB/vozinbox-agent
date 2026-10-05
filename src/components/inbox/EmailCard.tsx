import Link from 'next/link';
import { Paperclip, Sparkles } from 'lucide-react';
import type { InboxItem } from '@/lib/types/database';
import { CategoryBadge, DeadlineBadge, ReviewBadge, UnreadDot, PriorityBadge } from '@/components/ui/Badge';
import { cn, relativeTime, truncate } from '@/lib/utils';

/**
 * Inbox row (§7). Shows sender, subject, preview, time, read state, AI category,
 * priority, action indicator, deadline and attachment indicator.
 */
export function EmailCard({
  item,
  timezone,
  compact = false,
  className,
}: {
  item: InboxItem;
  timezone: string;
  compact?: boolean;
  className?: string;
}) {
  const { email, analysis, source_task: sourceTask } = item;
  const sender = email.sender_name ?? email.sender_email ?? 'Unknown sender';
  const preview = analysis?.summary ?? email.snippet ?? '';

  return (
    <Link
      href={`/inbox/${email.id}`}
      className={cn(
        'panel panel-hover group block p-4 transition-all',
        !email.is_read && 'border-violet-400/20 bg-violet-500/[0.04]',
        className,
      )}
      aria-label={`${email.is_read ? '' : 'Unread email. '}${sender}: ${email.subject ?? 'no subject'}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-1.5">
          <UnreadDot show={!email.is_read} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className={cn('truncate text-sm', !email.is_read ? 'font-semibold text-mist-50' : 'font-medium text-mist-200')}>
                {sender}
              </span>
              {email.sender_email && !compact ? (
                <span className="hidden truncate text-[11px] text-mist-600 sm:inline">{email.sender_email}</span>
              ) : null}
            </div>
            <time
              dateTime={email.received_at}
              className="shrink-0 text-[11px] text-mist-500"
              title={new Date(email.received_at).toLocaleString()}
            >
              {relativeTime(email.received_at)}
            </time>
          </div>

          <p className={cn('mt-1 truncate text-[13px]', email.is_read ? 'text-mist-300' : 'text-mist-100')}>
            {email.subject ?? '(no subject)'}
          </p>

          {!compact && preview ? (
            <p className="mt-1 line-clamp-2x text-xs leading-relaxed text-mist-500">{truncate(preview, 220)}</p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {analysis ? (
              <>
                <PriorityBadge priority={analysis.priority} />
                <CategoryBadge category={analysis.category} secondary={analysis.secondary_categories} />
                {analysis.detected_deadline?.date ? (
                  <DeadlineBadge
                    date={analysis.detected_deadline.date}
                    time={analysis.detected_deadline.time}
                    confidence={analysis.deadline_confidence}
                    tone={analysis.priority === 'CRITICAL' || analysis.priority === 'HIGH' ? 'warning' : 'default'}
                  />
                ) : null}
                {analysis.action_required && analysis.suggested_action && !compact ? (
                  <span className="chip chip-neutral max-w-[22rem] truncate">
                    <Sparkles className="h-3 w-3 shrink-0 text-violet-300" aria-hidden="true" />
                    <span className="truncate">{analysis.suggested_action}</span>
                  </span>
                ) : null}
                {analysis.needs_review ? <ReviewBadge reason={analysis.review_reason} /> : null}
              </>
            ) : (
              <span className="chip chip-neutral">
                {email.analysis_state === 'FAILED'
                  ? 'Analysis failed'
                  : email.analysis_state === 'ANALYZING'
                    ? 'Analysing…'
                    : 'Not analysed yet'}
              </span>
            )}

            {email.has_attachments ? (
              <span className="chip chip-neutral" title={email.attachments.map((a) => a.filename).join(', ')}>
                <Paperclip className="h-3 w-3" aria-hidden="true" />
                {email.attachments.length}
              </span>
            ) : null}

            {sourceTask ? (
              <span className="chip border-violet-400/25 bg-violet-500/10 text-violet-200">Task tracked</span>
            ) : null}
          </div>
        </div>
      </div>
      <span className="sr-only">Opens in {timezone} timezone context</span>
    </Link>
  );
}
