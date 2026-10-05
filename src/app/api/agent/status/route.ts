import { jsonOk, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { capabilityReport } from '@/lib/env';

/** Agent + integration status surfaced in the UI (§52). */
export const GET = withUser(async ({ auth }) => {
  const store = await getStore();
  const [accounts, counters, runs] = await Promise.all([
    store.listAccounts(auth.id),
    store.dashboardCounters(auth.id),
    store.listAgentRuns(auth.id, 5),
  ]);

  const latestRun = runs[0] ?? null;
  const connected = accounts.filter((account) => account.status === 'CONNECTED');

  return jsonOk({
    capabilities: capabilityReport(),
    accounts: accounts.map((account) => ({
      id: account.id,
      email: account.email_address,
      status: account.status,
      lastSyncAt: account.last_sync_at,
      lastSyncStatus: account.last_sync_status,
      lastSyncError: account.last_sync_error,
    })),
    counters,
    latestRun,
    state:
      connected.length === 0
        ? 'NO_INTEGRATION'
        : latestRun?.status === 'RUNNING'
          ? 'ANALYSING'
          : latestRun?.status === 'FAILED'
            ? 'ERROR'
            : counters.needsReview > 0
              ? 'NEEDS_REVIEW'
              : 'IDLE',
  });
});

export const runtime = 'nodejs';
