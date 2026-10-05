import type { Metadata } from 'next';
import { requireAuthContext } from '@/lib/auth';
import { getStore } from '@/lib/store';
import { listAccountHealth, isGmailReady } from '@/lib/integrations/accounts';
import { capabilityReport } from '@/lib/env';
import { PageHeader } from '@/components/layout/PageHeader';
import { IntegrationsView, type AccountHealthView } from '@/components/integrations/IntegrationsView';

export const metadata: Metadata = { title: 'Integrations' };
export const dynamic = 'force-dynamic';

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; message?: string }>;
}) {
  const auth = await requireAuthContext();
  const store = await getStore();
  const params = await searchParams;

  const [health, events] = await Promise.all([
    listAccountHealth(store, auth.id),
    store.listIntegrationEvents(auth.id, 20),
  ]);

  const accounts: AccountHealthView[] = health.map((entry) => ({
    account: entry.account,
    hasCredentials: entry.hasCredentials,
    connected: entry.connected,
    needsAttention: entry.needsAttention,
  }));

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <PageHeader
        title="Integrations"
        description="Connect the mailbox VozInbox should read. Access is read-only and revocable at any time."
      />

      {params.status === 'connected' ? (
        <p role="status" className="rounded-xl border border-positive/25 bg-positive/[0.07] p-3 text-xs text-mist-100">
          {params.message ?? 'Mailbox connected.'} Run a sync to fetch your messages.
        </p>
      ) : null}
      {params.status === 'denied' || params.status === 'error' ? (
        <p role="alert" className="rounded-xl border border-critical/25 bg-critical/[0.07] p-3 text-xs text-mist-100">
          {params.message ?? 'The connection could not be completed.'}
        </p>
      ) : null}

      <IntegrationsView
        accounts={accounts}
        events={events}
        capabilities={capabilityReport()}
        gmailReady={isGmailReady()}
      />
    </div>
  );
}
