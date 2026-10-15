import { AppError } from '@/lib/errors';
import { jsonOk, withUser } from '@/lib/api';
import { getStore } from '@/lib/store';

type Params = { id: string };

export const GET = withUser<Params>(async ({ auth, params }) => {
  const store = await getStore();
  const email = await store.getEmail(auth.id, params.id);
  if (!email) throw new AppError('NOT_FOUND', { message: 'Email not found' });
  const account = await store.getAccount(auth.id, email.account_id);
  if (!account || account.status !== 'CONNECTED' || account.provider !== 'gmail') {
    throw new AppError('NOT_FOUND', { message: 'Connected Gmail account not found' });
  }
  return jsonOk({
    emailId: email.id,
    accountId: account.id,
    accountEmail: account.email_address,
    senderEmail: email.sender_email,
    recipients: email.recipients.map((recipient) => recipient.email).filter((value): value is string => Boolean(value)),
    ccRecipients: (email.headers.cc?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []),
    subject: email.subject ?? '',
    body: email.body_text ?? email.snippet ?? '',
  });
});
