import { jsonOk, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { analyzeStoredEmail } from '@/lib/services/agent';
import { AppError } from '@/lib/errors';

/**
 * Re-analyse stored emails (e.g. after enabling an AI provider or changing the
 * confidence threshold). Bounded per request to keep the endpoint responsive.
 */
export const POST = withUser(
  async ({ auth }) => {
    const store = await getStore();
    const preferences = await store.getPreferences(auth.id);
    const page = await store.listInbox({ userId: auth.id, limit: 10, sort: 'NEWEST' });

    if (page.items.length === 0) {
      throw new AppError('NOT_FOUND', {
        message: 'No emails to reprocess',
        userMessage: 'There are no stored emails to re-analyse yet.',
      });
    }

    let analysed = 0;
    let failed = 0;
    for (const item of page.items) {
      const result = await analyzeStoredEmail({
        store,
        userId: auth.id,
        email: item.email,
        preferences,
        timezone: auth.timezone,
        trigger: 'REPROCESS',
      });
      if (result.status === 'FAILED') failed += 1;
      else analysed += 1;
    }

    return jsonOk({ analysed, failed, total: page.items.length });
  },
  { rateLimit: 'aiAnalysis' },
);

export const runtime = 'nodejs';
export const maxDuration = 120;
