'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { requestEmailCompose } from './EmailComposerHost';

type Summary = {
  purpose: string;
  summary: string;
  key_points: string[];
  requested_actions: string[];
  deadline: string | null;
  question_requires_response: boolean;
  reply_appropriate: boolean;
};
type ResponsePayload =
  | { ok: true; data: { summary: Summary; generatedAt: string; cached: boolean } }
  | { ok: false; error: { message: string } };

export function CachedEmailSummary({ emailId }: { emailId: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (regenerate: boolean) => {
    setError('');
    if (regenerate) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch(`/api/emails/${encodeURIComponent(emailId)}/summary`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ regenerate }),
      });
      const payload = await response.json() as ResponsePayload;
      if (!response.ok || !payload.ok) throw new Error(payload.ok ? 'Unable to summarize this email.' : payload.error.message);
      setSummary(payload.data.summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to summarize this email.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(false);
  // Load a summary once for this email; explicit refresh is user initiated.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailId]);

  return (
    <section className="panel p-5" aria-label="AI email summary">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mist-500">
          <Sparkles className="h-3.5 w-3.5 text-violet-300" aria-hidden="true" />
          AI email summary
        </h2>
        <button type="button" disabled={loading || refreshing} onClick={() => void load(true)} className="inline-flex items-center gap-1 text-[11px] text-mist-400 hover:text-mist-100 disabled:opacity-50" aria-label="Regenerate email summary">
          <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          Regenerate
        </button>
      </div>
      {loading ? <p className="text-sm text-mist-400" role="status">Summarizing this conversation…</p> : null}
      {error ? (
        <div role="alert" className="text-xs text-medium">
          <p>{error}</p>
          <button type="button" onClick={() => void load(false)} className="mt-2 underline underline-offset-2">Try again</button>
        </div>
      ) : null}
      {summary ? (
        <div className="space-y-3 text-sm">
          <p className="text-xs font-medium text-violet-200">{summary.purpose}</p>
          <p className="leading-relaxed text-mist-200">{summary.summary}</p>
          {summary.key_points.length ? (
            <ul className="list-disc space-y-1 pl-4 text-xs text-mist-300">{summary.key_points.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ul>
          ) : null}
          {summary.requested_actions.length ? (
            <div><h3 className="text-[11px] uppercase tracking-wide text-mist-500">Requested actions</h3><ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-mist-300">{summary.requested_actions.map((action, index) => <li key={`${index}-${action}`}>{action}</li>)}</ul></div>
          ) : null}
          {summary.deadline ? <p className="text-xs text-medium"><span className="text-mist-500">Deadline: </span>{summary.deadline}</p> : null}
          {summary.reply_appropriate ? (
            <button type="button" onClick={() => requestEmailCompose('reply', emailId)} className="text-xs font-medium text-violet-300 hover:text-violet-200">Reply to this email</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
