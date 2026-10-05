import { z } from 'zod';
import { jsonOk, parseJson, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const schema = z.object({ confirm: z.literal('DELETE') });

/**
 * Deletes everything VozInbox stores for this user (§37).
 *
 * This removes local records only. It deliberately does not claim to delete
 * anything from the email provider — the mailbox itself is untouched, and the
 * UI says exactly that.
 */
export const POST = withUser(
  async ({ auth, request }) => {
    await parseJson(request, schema);
    const store = await getStore();
    const counts = await store.deleteAllUserData(auth.id);
    logger.info('account.data_deleted', { userId: auth.id });
    if (Object.keys(counts).length === 0) {
      throw new AppError('DATABASE', { message: 'Deletion returned no summary' });
    }
    return jsonOk({ deleted: counts });
  },
  { rateLimit: 'profileMutation' },
);

export const runtime = 'nodejs';
