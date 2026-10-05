import { intQuery, jsonOk, requireQuery, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { parseSearchQuery, toInboxQueryInput } from '@/lib/search/query-parser';
import { zonedAnchor } from '@/lib/search/zones';

export const GET = withUser(
  async ({ auth, request }) => {
    const query = requireQuery(request, 'q');
    const store = await getStore();
    const parsed = parseSearchQuery(query, zonedAnchor(auth.timezone));
    const page = await store.listInbox(
      toInboxQueryInput(parsed, auth.id, {
        limit: intQuery(request, 'limit', 25),
        offset: intQuery(request, 'offset', 0),
      }),
    );

    return jsonOk({
      ...page,
      search: { query, interpretation: parsed.interpretation },
    });
  },
  { rateLimit: 'search' },
);

export const runtime = 'nodejs';
