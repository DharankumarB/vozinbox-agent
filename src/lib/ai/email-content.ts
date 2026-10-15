import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import type { Email } from '@/lib/types/database';

export const emailSummarySchema = z.object({
  purpose: z.string().min(1).max(240),
  summary: z.string().min(1).max(1200),
  key_points: z.array(z.string().min(1).max(240)).max(8),
  requested_actions: z.array(z.string().min(1).max(240)).max(8),
  deadline: z.string().max(120).nullable(),
  question_requires_response: z.boolean(),
  reply_appropriate: z.boolean(),
});

export type EmailSummaryOutput = z.infer<typeof emailSummarySchema>;

export function emailText(email: Pick<Email, 'body_text' | 'snippet' | 'subject'>): string {
  const text = email.body_text?.trim() || email.snippet?.trim() || email.subject?.trim() || '';
  return text.slice(0, 30_000);
}

export function hashEmailContent(email: Email, thread: Email[]): string {
  const messages = [...thread, email]
    .filter((message, index, all) => all.findIndex((item) => item.id === message.id) === index)
    .sort((a, b) => a.received_at.localeCompare(b.received_at))
    .slice(-12)
    .map((message) => ({
      sender: message.sender_email,
      subject: message.subject,
      receivedAt: message.received_at,
      text: emailText(message),
    }));
  return createHash('sha256').update(JSON.stringify(messages)).digest('hex');
}

export function parseEmailSummary(content: string): EmailSummaryOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    throw new AppError('AI_INVALID_OUTPUT', {
      message: 'AI email summary was not valid JSON',
      cause,
    });
  }
  const result = emailSummarySchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError('AI_INVALID_OUTPUT', {
      message: `AI email summary did not match the expected shape: ${result.error.message}`,
    });
  }
  return result.data;
}
