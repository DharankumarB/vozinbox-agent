import { jsonOk, requireQuery, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';

export const GET = withUser(async ({ auth, request }) => {
  const emailId = requireQuery(request, 'email_id');
  const store = await getStore();
  const [analysis, actions] = await Promise.all([
    store.getAnalysis(auth.id, emailId),
    store.listEmailActions(auth.id, emailId),
  ]);
  return jsonOk({ analysis, actions });
});

export const runtime = 'nodejs';
