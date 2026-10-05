import { jsonOk, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { listAccountHealth, isGmailReady } from '@/lib/integrations/accounts';
import { capabilityReport } from '@/lib/env';

export const GET = withUser(async ({ auth }) => {
  const store = await getStore();
  const [health, events] = await Promise.all([
    listAccountHealth(store, auth.id),
    store.listIntegrationEvents(auth.id, 20),
  ]);

  return jsonOk({
    accounts: health,
    events,
    capabilities: capabilityReport(),
    gmailReady: isGmailReady(),
  });
});

export const runtime = 'nodejs';
