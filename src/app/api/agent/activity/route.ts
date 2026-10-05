import { intQuery, jsonOk, optionalQuery, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';

export const GET = withUser(async ({ auth, request }) => {
  const store = await getStore();
  const emailId = optionalQuery(request, 'emailId');
  const [actions, runs] = await Promise.all([
    store.listAgentActions(auth.id, { limit: intQuery(request, 'limit', 60), emailId }),
    store.listAgentRuns(auth.id, 20),
  ]);
  return jsonOk({ actions, runs });
});

export const runtime = 'nodejs';
