import { z } from 'zod';
import { jsonOk, parseJson, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { disconnectGmail } from '@/lib/integrations/accounts';

const schema = z.object({ accountId: z.string().min(1).max(64), revoke: z.boolean().default(true) });

export const POST = withUser(
  async ({ auth, request }) => {
    const input = await parseJson(request, schema);
    const store = await getStore();
    await disconnectGmail({
      store,
      userId: auth.id,
      accountId: input.accountId,
      revoke: input.revoke,
    });
    return jsonOk({ disconnected: true });
  },
  { rateLimit: 'oauthStart' },
);

export const runtime = 'nodejs';
