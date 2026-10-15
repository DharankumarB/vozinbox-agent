import { z } from 'zod';
import { jsonOk, parseJson, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';
import { AppError } from '@/lib/errors';
import { getAccessToken } from '@/lib/integrations/accounts';
import { modifyMessageReadState } from '@/lib/integrations/gmail';
import { logger } from '@/lib/logger';

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

    if (body.isRead !== undefined && body.isRead !== email.is_read) {
      if (email.provider === 'gmail') {
        const account = await store.getAccount(auth.id, email.account_id);
        if (!account || account.provider !== 'gmail' || account.status !== 'CONNECTED') {
          throw new AppError('NOT_FOUND', {
            message: 'The Gmail account for this message is not connected',
            userMessage: 'Reconnect Gmail before changing this message’s read status.',
          });
        }
        const scope = 'https://www.googleapis.com/auth/gmail.modify';
        if (!account.scopes.includes(scope)) {
          throw new AppError('OAUTH_FAILED', {
            message: 'The connected Gmail account has not granted gmail.modify',
            userMessage: 'Reconnect Gmail to grant permission to synchronize read status, then retry.',
          });
        }
        const accessToken = await getAccessToken(store, auth.id, account);
        await modifyMessageReadState(accessToken, email.provider_message_id, body.isRead);
        try {
          await store.updateEmail(auth.id, params.id, { is_read: body.isRead });
        } catch (error) {
          try {
            await modifyMessageReadState(accessToken, email.provider_message_id, email.is_read);
          } catch (rollbackError) {
            logger.error('gmail.read_state_rollback_failed', {
              userId: auth.id,
              accountId: account.id,
              emailId: email.id,
            });
            throw new AppError('PROVIDER_ERROR', {
              message: 'Local read state could not be stored and Gmail rollback also failed',
              userMessage: 'The message state could not be synchronized. Sync Gmail before trying again.',
              cause: rollbackError,
            });
          }
          throw error;
        }
      } else {
        await store.updateEmail(auth.id, params.id, { is_read: body.isRead });
      }
    }
    if (body.isArchived !== undefined) {
      await store.updateEmail(auth.id, params.id, { is_archived: body.isArchived });
    }
    return jsonOk({ updated: true, isRead: body.isRead });
  },
  { rateLimit: 'emailMutation' },
);

export const runtime = 'nodejs';
