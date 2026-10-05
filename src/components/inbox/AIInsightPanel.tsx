import {
  AtSign,
  Building2,
  CalendarClock,
  FileText,
  Link2,
  ShieldAlert,
  Sparkles,
  ThumbsUp,
  Users,
} from 'lucide-react';
import type { EmailAnalysis } from '@/lib/types/database';
import { CategoryBadge, DeadlineBadge, PriorityBadge, ReviewBadge } from '@/components/ui/Badge';
import { cn, percent, shortDate, timeLabel } from '@/lib/utils';

/**
 * AI understanding panel (§8).
 * Presents exactly what the analysis stored — including confidence and the
 * evidence sentence behind the deadline. Uncertainty is shown, never hidden.
 */
export function AIInsightPanel({ analysis, className }: { analysis: EmailAnalysis | null; className?: string }) {
  if (!analysis) {
    return (
      <aside className={cn('panel p-5', className)} aria-label="AI understanding">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-500">AI understanding</h2>
        <p className="mt-3 text-sm text-mist-400">
          This message has not been analysed yet. Use “Analyse now” to run the agent pipeline.
        </p>
      </aside>
    );
  }

  const deadline = analysis.detected_deadline;
  const confidence = Math.round((analysis.overall_confidence ?? 0) * 100);

  return (
    <aside className={cn('space-y-4', className)} aria-label="AI understanding">
      <section className="panel p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-500">
            <Sparkles className="h-3.5 w-3.5 text-violet-300" aria-hidden="true" />
            AI understanding
          </h2>
          <span
            className="chip chip-neutral"
            title="Overall confidence across category, action, deadline and priority"
          >
            {confidence}% confidence
          </span>
        </div>

        <dl className="space-y-3.5 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-mist-500">Summary</dt>
            <dd className="mt-1 leading-relaxed text-mist-200">{analysis.summary ?? 'No summary available.'}</dd>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-mist-500">Category</dt>
              <dd className="mt-1.5">
                <CategoryBadge category={analysis.category} secondary={analysis.secondary_categories} />
                <span className="mt-1 block text-[11px] text-mist-500">
                  {percent(analysis.category_confidence)} confident
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-mist-500">Priority</dt>
              <dd className="mt-1.5">
                <PriorityBadge priority={analysis.priority} />
                <span className="mt-1 block text-[11px] text-mist-500">
                  {percent(analysis.priority_confidence)} confident
                </span>
              </dd>
            </div>
          </div>

          <div>
            <dt className="text-[11px] uppercase tracking-wide text-mist-500">Action required</dt>
            <dd className="mt-1 text-mist-200">
              {analysis.action_required ? (
                <span className="text-high">Yes</span>
              ) : (
                <span className="text-mist-400">No</span>
              )}
              {analysis.suggested_action ? (
                <span className="mt-1 block text-xs text-mist-300">{analysis.suggested_action}</span>
              ) : null}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] uppercase tracking-wide text-mist-500">Detected deadline</dt>
            <dd className="mt-1.5">
              {deadline?.date ? (
                <DeadlineBadge date={deadline.date} time={deadline.time} confidence={analysis.deadline_confidence} />
              ) : deadline?.type === 'UNKNOWN' ? (
                <span className="text-xs text-medium">Deadline could not be confidently determined.</span>
              ) : (
                <span className="text-xs text-mist-400">No deadline found in this message.</span>
              )}
              {deadline?.source_sentence ? (
                <p className="mt-2 border-l-2 border-white/[0.12] pl-3 text-[11px] italic leading-relaxed text-mist-500">
                  “{deadline.source_sentence}”
                </p>
              ) : null}
            </dd>
          </div>

          <div>
            <dt className="text-[11px] uppercase tracking-wide text-mist-500">Why this priority</dt>
            <dd className="mt-1 text-xs leading-relaxed text-mist-300">
              {analysis.priority_reason ?? 'No explanation recorded.'}
            </dd>
          </div>
        </dl>

        {analysis.needs_review ? (
          <div className="mt-4">
            <ReviewBadge reason={analysis.review_reason} />
            {analysis.review_reason ? (
              <p className="mt-2 text-[11px] leading-relaxed text-medium">{analysis.review_reason}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="panel p-5">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-500">
          Extracted details
        </h3>

        <div className="space-y-3 text-xs">
          <DetailRow icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />} label="Detected dates">
            {analysis.detected_dates.length === 0 ? (
              <span className="text-mist-500">None</span>
            ) : (
              <ul className="space-y-1">
                {analysis.detected_dates.map((entry, index) => (
                  <li key={`${entry.date ?? 'unknown'}-${index}`} className="text-mist-300">
                    {entry.date ? shortDate(entry.date) : 'Ambiguous'}
                    {entry.time ? ` · ${timeLabel(entry.time)}` : ''}
                    {entry.label ? ` — ${entry.label}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </DetailRow>

          <DetailRow icon={<Users className="h-3.5 w-3.5" aria-hidden="true" />} label="Detected people">
            {analysis.detected_people.length === 0 ? (
              <span className="text-mist-500">None</span>
            ) : (
              <ul className="space-y-1">
                {analysis.detected_people.map((person) => (
                  <li key={person.name} className="text-mist-300">
                    {person.name}
                    {person.email ? <span className="text-mist-500"> · {person.email}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </DetailRow>

          <DetailRow icon={<Building2 className="h-3.5 w-3.5" aria-hidden="true" />} label="Detected organizations">
            {analysis.detected_organizations.length === 0 ? (
              <span className="text-mist-500">None</span>
            ) : (
              <ul className="space-y-1">
                {analysis.detected_organizations.map((org) => (
                  <li key={org.name} className="text-mist-300">
                    {org.name}
                  </li>
                ))}
              </ul>
            )}
          </DetailRow>

          <DetailRow icon={<Link2 className="h-3.5 w-3.5" aria-hidden="true" />} label="Detected links">
            {analysis.detected_links.length === 0 ? (
              <span className="text-mist-500">None</span>
            ) : (
              <ul className="space-y-1">
                {analysis.detected_links.slice(0, 5).map((link) => (
                  <li key={link.url} className="break-anywhere">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-electric-300 hover:text-electric-400"
                    >
                      {link.url.slice(0, 70)}
                      {link.url.length > 70 ? '…' : ''}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </DetailRow>

          <DetailRow icon={<FileText className="h-3.5 w-3.5" aria-hidden="true" />} label="Attachments">
            {analysis.detected_attachments.length === 0 ? (
              <span className="text-mist-500">None</span>
            ) : (
              <ul className="space-y-1">
                {analysis.detected_attachments.map((attachment) => (
                  <li key={attachment.filename} className="break-anywhere text-mist-300">
                    📎 {attachment.filename}
                    {attachment.size_bytes ? (
                      <span className="text-mist-500"> · {Math.round(attachment.size_bytes / 1024)} KB</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </DetailRow>

          <DetailRow icon={<AtSign className="h-3.5 w-3.5" aria-hidden="true" />} label="Analysis source">
            <span className="text-mist-300">
              {analysis.analysis_source === 'AI_PROVIDER'
                ? `AI model (${analysis.model_name ?? 'configured provider'})`
                : 'Deterministic rules engine'}
              <span className="text-mist-500"> · v{analysis.analysis_version}</span>
            </span>
          </DetailRow>
        </div>
      </section>

      {analysis.injection_flagged ? (
        <section className="rounded-2xl border border-critical/25 bg-critical/[0.07] p-4">
          <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-critical">
            <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
            Untrusted content detected
          </h3>
          <p className="mt-2 text-[11px] leading-relaxed text-mist-200">
            This message contains text that looks like an instruction to an AI system. It was treated
            strictly as email content and was not acted on. Signals:{' '}
            <span className="font-mono text-[10px] text-mist-400">{analysis.injection_signals.join(', ')}</span>
          </p>
        </section>
      ) : null}

      <section className="panel p-5">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-500">
          <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
          Grounding check
        </h3>
        <p className="mt-2 text-[11px] leading-relaxed text-mist-400">
          {reportNotes(analysis)}
        </p>
      </section>
    </aside>
  );
}

function reportNotes(analysis: EmailAnalysis): string {
  const report = analysis.grounding_report as
    | { checked?: boolean; dropped_count?: number; notes?: string[] }
    | null;
  if (!report?.checked) return 'Deterministic analysis — every field is derived directly from the message text.';
  const dropped = report.dropped_count ?? 0;
  if (dropped === 0) return 'Every extracted detail was verified against the message text.';
  return `${dropped} extracted detail(s) could not be verified against the message and were removed before saving.`;
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 shrink-0 text-mist-500">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-mist-500">{label}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}
