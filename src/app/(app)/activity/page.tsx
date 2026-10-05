import type { Metadata } from 'next';
import { Activity, AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { requireAuthContext } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { aiConfig } from '@/lib/env';
import { PageHeader } from '@/components/layout/PageHeader';
import { ActivityFeed } from '@/components/agent/ActivityFeed';
import { EmptyState } from '@/components/ui/States';
import { ANALYSIS_SOURCE_LABELS } from '@/lib/types/domain';
import type { AgentRunStatus } from '@/lib/types/domain';
import { absoluteTime, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Agent Activity' };
export const dynamic = 'force-dynamic';

const RUN_STATUS_META: Record<AgentRunStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  PENDING: { icon: Loader2, className: 'text-mist-400', label: 'Queued' },
  RUNNING: { icon: Loader2, className: 'text-electric-300', label: 'Running' },
  COMPLETED: { icon: CheckCircle2, className: 'text-positive', label: 'Completed' },
  FAILED: { icon: XCircle, className: 'text-critical', label: 'Failed' },
  SKIPPED: { icon: AlertTriangle, className: 'text-mist-400', label: 'Skipped' },
  NEEDS_REVIEW: { icon: AlertTriangle, className: 'text-medium', label: 'Needs review' },
};

export default async function ActivityPage() {
  const auth = await requireAuthContext();
  const store = await getStore();

  const [actions, runs] = await Promise.all([
    store.listAgentActions(auth.id, { limit: 80 }),
    store.listAgentRuns(auth.id, 15),
  ]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <PageHeader
        title="Agent Activity"
        description="A transparent audit trail of what the agent did, which data it read and what it changed."
      />

      <section className="panel p-5" aria-label="Recent agent runs">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-500">
          Recent agent runs
        </h2>

        {runs.length === 0 ? (
          <p className="text-xs text-mist-500">No agent runs yet. Sync your inbox to start the record.</p>
        ) : (
          <ul className="space-y-2.5">
            {runs.map((run) => {
              const meta = RUN_STATUS_META[run.status];
              const Icon = meta.icon;
              return (
                <li key={run.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon
                        className={`h-3.5 w-3.5 ${meta.className} ${run.status === 'RUNNING' ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      <span className="font-medium text-mist-100">
                        {meta.label} · {run.trigger.toLowerCase()}
                      </span>
                      {run.analysis_source ? (
                        <span className="chip chip-neutral">{ANALYSIS_SOURCE_LABELS[run.analysis_source]}</span>
                      ) : null}
                    </div>
                    <time dateTime={run.started_at} className="text-[11px] text-mist-500" title={absoluteTime(run.started_at, auth.timezone)}>
                      {relativeTime(run.started_at)}
                    </time>
                  </div>

                  <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-mist-500">
                    <div>
                      <dt className="inline">Step: </dt>
                      <dd className="inline text-mist-400">{run.current_step ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="inline">Tools: </dt>
                      <dd className="inline text-mist-400">
                        {run.tool_calls} used / depth {run.tool_depth} of {run.max_tool_depth}
                      </dd>
                    </div>
                    {run.confidence !== null ? (
                      <div>
                        <dt className="inline">Confidence: </dt>
                        <dd className="inline text-mist-400">{Math.round(run.confidence * 100)}%</dd>
                      </div>
                    ) : null}
                    {run.duration_ms !== null ? (
                      <div>
                        <dt className="inline">Duration: </dt>
                        <dd className="inline text-mist-400">{Math.round(run.duration_ms)} ms</dd>
                      </div>
                    ) : null}
                    {run.model_name ? (
                      <div>
                        <dt className="inline">Model: </dt>
                        <dd className="inline text-mist-400">{run.model_name}</dd>
                      </div>
                    ) : null}
                  </dl>

                  {run.error_message ? (
                    <p className="mt-2 rounded-lg bg-critical/[0.08] px-2.5 py-1.5 break-anywhere text-[11px] text-critical">
                      {run.error_code ? `${run.error_code}: ` : ''}
                      {run.error_message}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-3 text-[11px] text-mist-600">
          Tool depth is capped at {aiConfig()?.maxToolDepth ?? 4} rounds per task. The agent never sends, deletes or
          forwards email.
        </p>
      </section>

      <section className="panel p-5" aria-label="Activity timeline">
        <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-500">
          <Activity className="h-3.5 w-3.5" aria-hidden="true" />
          Timeline
        </h2>
        {actions.length === 0 ? (
          <EmptyState
            title="No agent activity yet"
            description="Actions taken by the agent — syncing, analysing, suggesting tasks, sending notifications — will be listed here."
          />
        ) : (
          <ActivityFeed actions={actions} />
        )}
      </section>
    </div>
  );
}
