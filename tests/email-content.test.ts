import { describe, expect, it } from 'vitest';
import { hashEmailContent, parseEmailSummary } from '@/lib/ai/email-content';
import type { Email } from '@/lib/types/database';

const email = (overrides: Partial<Email> = {}): Email => ({
  id: 'email-1',
  user_id: 'user-1',
  account_id: 'account-1',
  thread_id: null,
  provider: 'gmail',
  provider_message_id: 'provider-1',
  provider_thread_id: 'thread-1',
  sender_name: 'Sender',
  sender_email: 'sender@example.com',
  recipient: 'me@example.com',
  recipients: [{ name: null, email: 'me@example.com' }],
  subject: 'Subject',
  snippet: 'Preview',
  body_text: 'Message body',
  body_html: null,
  received_at: '2025-01-01T00:00:00.000Z',
  is_read: false,
  is_archived: false,
  has_attachments: false,
  attachments: [],
  labels: [],
  headers: {},
  size_estimate: null,
  analysis_state: 'PENDING',
  analyzed_at: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

describe('AI email summary content', () => {
  it('changes its cache key when the message body changes', () => {
    expect(hashEmailContent(email(), [])).not.toBe(hashEmailContent(email({ body_text: 'Updated body' }), []));
  });

  it('validates the model response shape and rejects fabricated shapes', () => {
    const valid = {
      purpose: 'Schedule a meeting',
      summary: 'The sender proposes Tuesday.',
      key_points: ['Tuesday is suggested'],
      requested_actions: ['Confirm a time'],
      deadline: null,
      question_requires_response: true,
      reply_appropriate: true,
    };
    expect(parseEmailSummary(JSON.stringify(valid))).toEqual(valid);
    expect(() => parseEmailSummary(JSON.stringify({ summary: 'Missing fields' }))).toThrow();
  });
});
