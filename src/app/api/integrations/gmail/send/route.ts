import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { jsonOk, parseJson, withUser } from '@/lib/api';
import { getAccessToken } from '@/lib/integrations/accounts';
import { getMessage, sendGmailMessage } from '@/lib/integrations/gmail';
import { logger } from '@/lib/logger';
import { getStore } from '@/lib/store';

const addressList = z.array(z.string().email().max(254)).max(50);
const requestSchema = z.object({
  accountId: z.string().uuid(),
  mode: z.enum(['new', 'reply', 'reply-all', 'forward']),
  emailId: z.string().uuid().optional(),
  to: addressList,
  cc: addressList.default([]),
  bcc: addressList.default([]),
  subject: z.string().max(998),
  body: z.string().min(1).max(500_000),
});
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const EMAIL_PATTERN = /^[^\s<>@,;:"()[\]\\]+@[^\s<>@,;:"()[\]\\]+\.[^\s<>@,;:"()[\]\\]+$/;

function uniqueRecipients(addresses: string[], ownAddress: string): string[] {
  const seen = new Set([ownAddress.toLowerCase()]);
  return addresses.filter((address) => {
    const normalized = address.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(address.trim())) {
      throw new AppError('VALIDATION', { message: 'Invalid recipient address' });
    }
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export const POST = withUser(async ({ auth, request }) => {
  const body = await parseJson(request, requestSchema);
  const store = await getStore();
  const account = await store.getAccount(auth.id, body.accountId);
  if (!account || account.provider !== 'gmail' || account.status !== 'CONNECTED') {
    throw new AppError('NOT_FOUND', { message: 'Connected Gmail account not found' });
  }
  if (!account.scopes.includes(SEND_SCOPE)) {
    throw new AppError('OAUTH_FAILED', {
      message: 'The connected account does not have gmail.send',
      userMessage: 'Update Gmail permissions to allow sending messages, then retry.',
    });
  }
  const original = body.emailId ? await store.getEmail(auth.id, body.emailId) : null;
  if (body.mode !== 'new' && (!original || original.account_id !== account.id)) {
    throw new AppError('NOT_FOUND', { message: 'Original email not found in the selected mailbox' });
  }
  if (body.mode === 'new' && body.emailId) {
    throw new AppError('VALIDATION', { message: 'New messages cannot be associated with an email thread' });
  }

  const ownAddress = account.email_address.toLowerCase();
  const to = uniqueRecipients(body.to, ownAddress);
  const toSet = new Set(to.map((address) => address.toLowerCase()));
  const cc = uniqueRecipients(body.cc, ownAddress).filter((address) => !toSet.has(address.toLowerCase()));
  const ccSet = new Set(cc.map((address) => address.toLowerCase()));
  const bcc = uniqueRecipients(body.bcc, ownAddress).filter(
    (address) => !toSet.has(address.toLowerCase()) && !ccSet.has(address.toLowerCase()),
  );
  if (to.length === 0) {
    throw new AppError('VALIDATION', { message: 'No valid recipient remains after removing the sender address' });
  }

  const references = original?.headers.references ?? original?.headers.References ?? '';
  const inReplyTo = original?.headers['message-id'] ?? original?.headers['Message-ID'] ?? '';
  const referenceChain = [references, inReplyTo].filter(Boolean).join(' ').trim();
  const accessToken = await getAccessToken(store, auth.id, account);
  const result = await sendGmailMessage(
    accessToken,
    {
      to,
      cc,
      bcc,
      subject: body.subject,
      body: body.body,
      ...(original ? { threadId: original.provider_thread_id } : {}),
      ...(original && inReplyTo ? { inReplyTo } : {}),
      ...(original && referenceChain ? { references: referenceChain } : {}),
    },
    account.email_address,
  );

  let synced = false;
  try {
    const sent = await getMessage(accessToken, result.id);
    const priorThread = original?.thread_id ? await store.getThread(auth.id, original.thread_id) : null;
    const thread = await store.upsertThread({
      user_id: auth.id,
      account_id: account.id,
      provider: 'gmail',
      provider_thread_id: result.threadId,
      subject: sent.subject,
      participants: sent.recipients,
      last_message_at: sent.receivedAt,
      message_count: (priorThread?.message_count ?? 0) + 1,
    });
    await store.upsertEmail({
      user_id: auth.id,
      account_id: account.id,
      thread_id: thread.id,
      provider: 'gmail',
      provider_message_id: result.id,
      provider_thread_id: result.threadId,
      sender_name: account.display_name,
      sender_email: account.email_address,
      recipient: sent.recipient,
      recipients: sent.recipients,
      subject: sent.subject,
      snippet: sent.snippet,
      body_text: sent.bodyText,
      body_html: sent.bodyHtml,
      received_at: sent.receivedAt,
      is_read: true,
      has_attachments: sent.hasAttachments,
      attachments: sent.attachments,
      labels: sent.labels,
      headers: sent.headers,
      size_estimate: sent.sizeEstimate,
    });
    synced = true;
  } catch (error) {
    logger.error('gmail.sent_message_sync_failed', {
      userId: auth.id,
      accountId: account.id,
      providerMessageId: result.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return jsonOk({ sent: true, synced, messageId: result.id, threadId: result.threadId });
}, { rateLimit: 'emailMutation' });

export const runtime = 'nodejs';
