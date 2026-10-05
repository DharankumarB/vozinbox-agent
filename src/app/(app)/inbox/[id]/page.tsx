import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Clock3, GitBranch, Info, Paperclip, ShieldAlert } from 'lucide-react';
import { requireAuthContext } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { AIInsightPanel } from '@/components/inbox/AIInsightPanel';
import { SuggestedTaskCard } from '@/components/inbox/SuggestedTaskCard';
import { EmailActionsBar } from '@/components/inbox/EmailActionsBar';
import { ActivityFeed } from '@/components/agent/ActivityFeed';
import { PageHeader } from '@/components/layout/PageHeader';
import { CategoryBadge, DeadlineBadge, PriorityBadge, ReviewBadge } from '@/components/ui/Badge';
import { absoluteTime, initials, relativeTime } from '@/lib/utils';
import type { TaskStatus, EmailPriority } from '@/lib/types/domain';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const auth = await requireAuthContext();
  const store = await getStore();
  const email = await store.getEmail(auth.id, id);
  return { title: email?.subject ?? 'Email' };
}

export default async function EmailDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuthContext();
  const store = await getStore();

  const email = await store.getEmail(auth.id, id);
  if (!email) notFound();

  const [analysis, actions, thread, threadMessages, tasks, taskHistory] = await Promise.all([
    store.getAnalysis(auth.id, id),
    store.listEmailActions(auth.id, id),
    email.thread_id ? store.getThread(auth.id, email.thread_id) : Promise.resolve(null),
    email.thread_id
      ? store.listInbox({ userId: auth.id, threadId: email.thread_id, limit: 20, sort: 'OLDEST' })
      : Promise.resolve({ items: [], total: 0, limit: 0, offset: 0, hasMore: false }),
    store.listTasks({ userId: auth.id, status: 'ALL', limit: 200 }),
    store.listAnalysisHistory(auth.id, id),
  ]);

  const sourceTask = tasks.items.find((item) => item.task.source_email_id === email.id) ?? null;
  const agentActivity = await store.listAgentActions(auth.id, { limit: 12, emailId: email.id });

  const sender = email.sender_name ?? email.sender_email ?? 'Unknown sender';
  const body = email.body_text ?? '';
  const changes = thread?.changes_detected ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <Link
        href="/inbox"
        className="inline-flex items-center gap-1.5 text-xs text-mist-400 transition-colors hover:text-mist-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to inbox
      </Link>

      <PageHeader
        title={email.subject ?? '(no subject)'}
        action={<EmailActionsBar emailId={email.id} isRead={email.is_read} />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* ── Main column: the original message ─────────────────────────────── */}
        <div className="min-w-0 space-y-5">
          <article className="panel p-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-xs font-semibold text-mist-200">
                  {initials(sender)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-mist-100">{sender}</p>
                  {email.sender_email ? (
                    <p className="truncate text-xs text-mist-500">{email.sender_email}</p>
                  ) : null}
                </div>
              </div>
              <div className="text-right text-[11px] text-mist-500">
                <time dateTime={email.received_at}>{absoluteTime(email.received_at, auth.timezone)}</time>
                <span className="block">{relativeTime(email.received_at)}</span>
              </div>
            </header>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {analysis ? (
                <>
                  <PriorityBadge priority={analysis.priority} />
                  <CategoryBadge category={analysis.category} secondary={analysis.secondary_categories} />
                  {analysis.detected_deadline?.date ? (
                    <DeadlineBadge
                      date={analysis.detected_deadline.date}
                      time={analysis.detected_deadline.time}
                      confidence={analysis.deadline_confidence}
                    />
                  ) : null}
                  {analysis.needs_review ? <ReviewBadge reason={analysis.review_reason} /> : null}
                </>
              ) : null}
              {email.has_attachments ? (
                <span className="chip chip-neutral">
                  <Paperclip className="h-3 w-3" aria-hidden="true" />
                  {email.attachments.length}
                </span>
              ) : null}
            </div>

            <div className="divider my-4" />

            {body ? (
              <div className="whitespace-pre-wrap break-anywhere text-sm leading-relaxed text-mist-200">
                {body}
              </div>
            ) : (
              <p className="text-sm text-mist-400">
                This message has no readable plain-text body. Rich HTML content is not rendered for
                safety — the AI analysis above is based on the extracted text and snippet.
              </p>
            )}

            {email.attachments.length > 0 ? (
              <div className="mt-5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <p className="mb-2 text-[11px] uppercase tracking-wide text-mist-500">Attachments</p>
                <ul className="space-y-1.5 text-xs">
                  {email.attachments.map((attachment) => (
                    <li key={attachment.filename} className="break-anywhere text-mist-300">
                      📎 {attachment.filename}
                      {attachment.mime_type ? <span className="text-mist-500"> · {attachment.mime_type}</span> : null}
                      {attachment.size_bytes ? (
                        <span className="text-mist-500"> · {Math.round(attachment.size_bytes / 1024)} KB</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 flex items-start gap-1.5 text-[11px] text-mist-500">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  Attachment contents are not opened or executed. Only metadata is read.
                </p>
              </div>
            ) : null}
          </article>

          {analysis ? (
            <SuggestedTaskCard
              analysis={analysis}
              emailId={email.id}
              task={
                sourceTask
                  ? {
                      id: sourceTask.task.id,
                      title: sourceTask.task.title,
                      status: sourceTask.task.status as TaskStatus,
                      due_date: sourceTask.task.due_date,
                      due_time: sourceTask.task.due_time,
                      priority: sourceTask.task.priority as EmailPriority,
                    }
                  : null
              }
            />
          ) : null}

          {changes.length > 0 ? (
            <section className="rounded-2xl border border-medium/25 bg-medium/[0.07] p-4" aria-label="Information changed">
              <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-medium">
                <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                Information changed in this thread
              </h2>
              <ul className="mt-3 space-y-2.5">
                {changes.map((change) => (
                  <li key={`${change.type}-${change.detected_at}`} className="text-xs text-mist-200">
                    <p className="font-medium">{change.type.replaceAll('_', ' ').toLowerCase()}</p>
                    <p className="mt-0.5 text-mist-400">{change.description}</p>
                    {change.previous || change.current ? (
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                        {change.previous ? (
                          <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-mist-400 line-through">
                            {change.previous}
                          </span>
                        ) : null}
                        {change.current ? (
                          <span className="rounded-md bg-medium/15 px-1.5 py-0.5 text-medium">{change.current}</span>
                        ) : null}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {actions.length > 0 ? (
            <section className="panel p-5" aria-label="Extracted actions">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-500">
                Extracted actions
              </h2>
              <ul className="space-y-3">
                {actions.map((action) => (
                  <li key={action.id} className="text-xs">
                    <p className="font-medium text-mist-100">{action.action_text}</p>
                    {action.source_sentence ? (
                      <p className="mt-1 border-l-2 border-white/[0.12] pl-3 italic text-mist-400">
                        “{action.source_sentence}”
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-mist-500">
                      {action.due_date ? `Due ${action.due_date}` : 'No date stated'}
                      {action.due_time ? ` at ${action.due_time}` : ''} · {Math.round(action.confidence * 100)}% confidence
                      {action.status !== 'OPEN' ? ` · ${action.status.toLowerCase().replace('_', ' ')}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {threadMessages.items.length > 1 ? (
            <section className="panel p-5" aria-label="Thread">
              <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-500">
                <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                Thread · {threadMessages.items.length} messages
              </h2>
              <ol className="space-y-2.5">
                {threadMessages.items.map((item) => {
                  const isCurrent = item.email.id === email.id;
                  return (
                    <li key={item.email.id}>
                      <Link
                        href={`/inbox/${item.email.id}`}
                        className={`block rounded-xl border p-3 text-xs transition-colors ${
                          isCurrent
                            ? 'border-violet-400/30 bg-violet-500/[0.08]'
                            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="truncate font-medium text-mist-200">
                            {item.email.sender_name ?? item.email.sender_email ?? 'Unknown'}
                          </span>
                          <span className="shrink-0 text-[10px] text-mist-500">
                            <Clock3 className="mr-1 inline h-3 w-3" aria-hidden="true" />
                            {relativeTime(item.email.received_at)}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-mist-500">{item.email.snippet ?? ''}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
              {thread?.thread_state?.deadline?.date ? (
                <p className="mt-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-[11px] text-mist-300">
                  <strong className="font-semibold text-mist-100">Thread conclusion:</strong> the latest
                  authoritative message sets the deadline to {thread.thread_state.deadline.date}
                  {thread.thread_state.deadline.time ? ` at ${thread.thread_state.deadline.time}` : ''}.
                </p>
              ) : null}
            </section>
          ) : null}

          {taskHistory.length > 0 ? (
            <section className="panel p-5" aria-label="Analysis history">
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-500">
                Previous interpretations
              </h2>
              <ul className="space-y-2.5 text-xs">
                {taskHistory.map((entry) => (
                  <li key={entry.id} className="text-mist-400">
                    <span className="text-mist-500">{absoluteTime(entry.created_at, auth.timezone)}</span>
                    <span className="ml-2">
                      {entry.change_summary.length > 0
                        ? entry.change_summary.map((change) => change.description).join(' ')
                        : 'Analysis snapshot stored for audit.'}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        {/* ── AI panel (§39: becomes a stacked section on mobile) ───────────── */}
        <AIInsightPanel analysis={analysis} />

        <section className="panel p-5 lg:col-start-2" aria-label="Agent activity for this email">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-500">
            Agent activity
          </h2>
          <ActivityFeed actions={agentActivity} compact />
        </section>
      </div>

      {analysis?.injection_flagged ? (
        <p className="flex items-start gap-2 rounded-xl border border-critical/25 bg-critical/[0.06] p-3 text-xs text-mist-200">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-critical" aria-hidden="true" />
          This message attempted to instruct the AI. It was ignored and treated purely as email content.
        </p>
      ) : null}
    </div>
  );
}
