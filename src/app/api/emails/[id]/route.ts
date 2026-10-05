import { z } from 'zod';
import { jsonOk, parseJson, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { AppError } from '@/lib/errors';

type Params = { id: string };

export const GET = withUser<Params>(async ({ auth, params }) => {
  const store = await getStore();
  const email = await store.getEmail(auth.id, params.id);
  if (!email) {
    throw new AppError('NOT_FOUND', { message: 'Email not found', userMessage: 'That email could not be found.' });
  }

  const [analysis, actions, history, thread, threadMessages] = await Promise.all([
    store.getAnalysis(auth.id, params.id),
    store.listEmailActions(auth.id, params.id),
    store.listAnalysisHistory(auth.id, params.id),
    email.thread_id ? store.getThread(auth.id, email.thread_id) : Promise.resolve(null),
    email.thread_id
      ? store.listInbox({ userId: auth.id, threadId: email.thread_id, limit: 25, sort: 'OLDEST' })
      : Promise.resolve({ items: [], total: 0, limit: 0, offset: 0, hasMore: false }),
  ]);

  return jsonOk({
    email,
    analysis,
    actions,
    history,
    thread,
    threadMessages: threadMessages.items,
  });
});

const patchSchema = z.object({ isRead: z.boolean().optional(), isArchived: z.boolean().optional() });

export const PATCH = withUser<Params>(
  async ({ auth, params, request }) => {
    const body = await parseJson(request, patchSchema);
    const store = await getStore();
    const email = await store.getEmail(auth.id, params.id);
    if (!email) throw new AppError('NOT_FOUND', { message: 'Email not found' });

    await store.updateEmail(auth.id, params.id, {
      ...(body.isRead === undefined ? {} : { is_read: body.isRead }),
      ...(body.isArchived === undefined ? {} : { is_archived: body.isArchived }),
    });
    return jsonOk({ updated: true });
  },
  { rateLimit: 'emailMutation' },
);

export const runtime = 'nodejs';
