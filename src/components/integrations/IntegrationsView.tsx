'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Plug, PlugZap, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import type { EmailAccount, IntegrationEvent } from '@/lib/types/database';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { ConnectGmailButton } from './ConnectGmailButton';
import { absoluteTime, relativeTime } from '@/lib/utils';
import type { CapabilityReport } from '@/lib/env';

export interface AccountHealthView {
  account: EmailAccount;
  hasCredentials: boolean;
  connected: boolean;
  needsAttention: boolean;
}

export function IntegrationsView({
  accounts,
  events,
  capabilities,
  gmailReady,
}: {
  accounts: AccountHealthView[];
  events: IntegrationEvent[];
  capabilities: CapabilityReport;
  gmailReady: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState<AccountHealthView | null>(null);
  const [reprocessing, setReprocessing] = useState(false);

  const sync = async (accountId?: string) => {
    setBusy(accountId ?? 'sync');
    try {
      const response = await fetch('/api/integrations/gmail/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(accountId ? { accountId } : {}),
      });
      const payload = (await response.json()) as
        | { ok: true; data: { summaries: Array<{ status: string; message: string; analyzed: number }> } }
        | { ok: false; error: { message: string } };
      if (!payload.ok) {
        toast.push(payload.error.message, 'error');
        return;
      }
      const summary = payload.data.summaries[0];
      toast.push(
        summary?.message ?? 'Sync finished.',
        summary?.status === 'FAILED' ? 'error' : summary?.status === 'PARTIAL' ? 'info' : 'success',
      );
      router.refresh();
    } catch {
      toast.push('Unable to reach the sync service. Please try again.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!disconnecting) return;
    setBusy(disconnecting.account.id);
    try {
      const response = await fetch('/api/integrations/gmail/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accountId: disconnecting.account.id, revoke: true }),
      });
      const payload = (await response.json()) as { ok: boolean; error?: { message: string } };
      if (!payload.ok) {
        toast.push(payload.error?.message ?? 'Unable to disconnect this mailbox.', 'error');
        return;
      }
      toast.push('Mailbox disconnected. Stored credentials were deleted.', 'success');
      router.refresh();
    } catch {
      toast.push('Unable to complete this action. Please try again.', 'error');
    } finally {
      setBusy(null);
      setDisconnecting(null);
    }
  };

  const reprocess = async () => {
    setReprocessing(true);
    try {
      const response = await fetch('/api/integrations/gmail/reprocess', { method: 'POST' });
      const payload = (await response.json()) as
        | { ok: true; data: { analysed: number; failed: number; total: number } }
        | { ok: false; error: { message: string } };
      if (!payload.ok) {
        toast.push(payload.error.message, 'error');
        return;
      }
      toast.push(
        `Re-analysed ${payload.data.analysed} of ${payload.data.total} messages${
          payload.data.failed > 0 ? ` (${payload.data.failed} failed)` : ''
        }.`,
        payload.data.failed > 0 ? 'info' : 'success',
      );
      router.refresh();
    } catch {
      toast.push('Unable to complete this action. Please try again.', 'error');
    } finally {
      setReprocessing(false);
    }
  };

  const anyConnected = accounts.some((entry) => entry.connected);

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03]">
              <Plug className="h-5 w-5 text-violet-300" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-mist-50">Gmail</h2>
              <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-mist-400">
                Read-only access via Google OAuth (<code className="font-mono text-[10px]">gmail.readonly</code>).
                VozInbox never sends, deletes or modifies your email, and never asks for your password.
              </p>
            </div>
          </div>
          <ConnectGmailButton
            configured={gmailReady}
            label={accounts.length > 0 ? 'Connect another mailbox' : 'Connect Gmail'}
          />
        </div>

        {!gmailReady ? (
          <div className="mt-4 rounded-xl border border-medium/25 bg-medium/[0.07] p-3 text-[11px] leading-relaxed text-medium">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Gmail connection is unavailable:{' '}
                {capabilities.gmail === 'not_configured'
                  ? 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / TOKEN_ENCRYPTION_KEY'
                  : 'configuration'}{' '}
                is incomplete. Until then the inbox cannot be synced — everything else keeps working.
              </span>
            </p>
          </div>
        ) : null}

        {accounts.length === 0 ? (
          <EmptyState
            className="mt-4"
            icon={<PlugZap className="h-5 w-5" aria-hidden="true" />}
            title="No mailbox connected yet"
            description="Connect Gmail to let VozInbox read permitted messages and turn them into intelligence."
          />
        ) : (
          <ul className="mt-4 space-y-3">
            {accounts.map(({ account, connected, hasCredentials, needsAttention }) => (
              <li key={account.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-mist-100">{account.email_address}</p>
                      <span
                        className={`chip ${
                          connected
                            ? 'border-positive/30 bg-positive/10 text-positive'
                            : needsAttention
                              ? 'border-critical/30 bg-critical/10 text-critical'
                              : 'chip-neutral'
                        }`}
                      >
                        {connected ? (
                          <>
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            Connected
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            Needs attention
                          </>
                        )}
                      </span>
                    </div>

                    <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[11px] text-mist-500 sm:grid-cols-2">
                      <div>
                        <dt className="inline">Last synced: </dt>
                        <dd className="inline text-mist-400">
                          {account.last_sync_at ? relativeTime(account.last_sync_at) : 'never'}
                        </dd>
                      </div>
                      <div>
                        <dt className="inline">Incremental cursor: </dt>
                        <dd className="inline text-mist-400">
                          {account.last_history_id ? 'tracked' : 'not yet set'}
                        </dd>
                      </div>
                      {account.last_sync_error ? (
                        <div className="sm:col-span-2">
                          <dt className="inline">Last error: </dt>
                          <dd className="inline break-anywhere text-critical">{account.last_sync_error}</dd>
                        </div>
                      ) : null}
                    </dl>

                    <p className="mt-2 flex items-center gap-1.5 text-[11px] text-mist-500">
                      <ShieldCheck className="h-3 w-3 shrink-0 text-positive" aria-hidden="true" />
                      {hasCredentials
                        ? 'OAuth tokens are encrypted at rest and never leave the server.'
                        : 'No stored credentials — reconnect required.'}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => sync(account.id)}
                      loading={busy === account.id}
                      disabled={!connected}
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      Sync now
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setDisconnecting({ account, hasCredentials, connected, needsAttention })}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Disconnect
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold text-mist-50">Analysis maintenance</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-mist-400">
          Re-run the agent pipeline over your most recent stored messages — useful after enabling an AI
          provider or changing your confidence threshold.
        </p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={reprocess}
          loading={reprocessing}
          disabled={!anyConnected}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Re-analyse recent messages
        </Button>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold text-mist-50">Integration events</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-mist-400">
          Connection and sync telemetry. Technical details are logged server-side; tokens are never recorded.
        </p>
        {events.length === 0 ? (
          <p className="mt-3 text-xs text-mist-500">No integration events recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-mist-200">{event.event_type.toLowerCase().replaceAll('_', ' ')}</p>
                  {event.message ? <p className="mt-0.5 break-anywhere text-mist-500">{event.message}</p> : null}
                </div>
                <span className="shrink-0 text-[11px] text-mist-600" title={absoluteTime(event.created_at)}>
                  {relativeTime(event.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={disconnecting !== null}
        onClose={() => setDisconnecting(null)}
        onConfirm={disconnect}
        title="Disconnect this mailbox?"
        message="VozInbox will stop syncing, revoke its access token at Google, and delete the stored credentials. Your emails remain untouched in your Google account."
        confirmLabel="Disconnect"
        destructive
        loading={busy === disconnecting?.account.id}
      />
    </div>
  );
}
