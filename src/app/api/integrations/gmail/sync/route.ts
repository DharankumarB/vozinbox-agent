import { z } from 'zod';
import { jsonOk, parseJson, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { syncUserAccounts } from '@/lib/services/agent';

const schema = z.object({
  accountId: z.string().min(1).max(64).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const POST = withUser(
  async ({ auth, request }) => {
    const input = await parseJson(request, schema);
    const store = await getStore();
    const summaries = await syncUserAccounts({
      store,
      userId: auth.id,
      timezone: auth.timezone,
      accountId: input.accountId,
      limit: input.limit,
    });
    return jsonOk({ summaries });
  },
  { rateLimit: 'sync' },
);

export const runtime = 'nodejs';
export const maxDuration = 120;
