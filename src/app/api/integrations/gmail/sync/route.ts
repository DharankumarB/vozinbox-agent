import { z } from 'zod';
import { jsonOk, parseJson, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { syncUserAccounts } from '@/lib/services/agent';

const syncSchema = z.object({
  accountId: z.string().min(1).max(128).optional(),
});

export const POST = withUser(
  async ({ auth, request }) => {
    const input = await parseJson(request, syncSchema);
    const store = await getStore();
    const summaries = await syncUserAccounts({
      store,
      userId: auth.id,
      timezone: auth.timezone,
      accountId: input.accountId,
    });

    return jsonOk({ summaries });
  },
  { rateLimit: 'sync' },
);

export const runtime = 'nodejs';
export const maxDuration = 300;
