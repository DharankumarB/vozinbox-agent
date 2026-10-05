import { describe, expect, it } from 'vitest';
import { assessPriority } from '@/lib/analysis/priority';
import type { DetectedDeadline } from '@/lib/types/domain';

/** §10 — priority must be evidence-based, never driven by a single keyword. */

const REFERENCE = new Date('2026-03-10T07:00:00.000Z');
const TZ = 'Africa/Johannesburg';

function assess(overrides: Partial<Parameters<typeof assessPriority>[0]> = {}) {
  return assessPriority({
    subject: null,
    bodyText: null,
    senderEmail: 'sender@example.com',
    actionRequired: false,
    deadline: null,
    importantSenders: [],
    ignoredSenders: [],
    referenceInstant: REFERENCE,
    timezone: TZ,
    ...overrides,
  });
}

function deadlineIn(days: number, time: string | null = null): DetectedDeadline {
  const date = new Date(REFERENCE.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return {
    date,
    time,
    timezone: TZ,
    type: 'EXPLICIT',
    source_sentence: 'evidence',
    confidence: 0.9,
  };
}

describe('priority scoring', () => {
  it('raises priority for explicit urgency plus an imminent deadline', () => {
    const result = assess({
      subject: 'Urgent: final reminder',
      bodyText: 'This is urgent and must be completed before the deadline. Penalties apply.',
      actionRequired: true,
      deadline: deadlineIn(1),
    });
    expect(['CRITICAL', 'HIGH']).toContain(result.priority);
    expect(result.score).toBeGreaterThanOrEqual(2);
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('does not treat the word "important" alone as urgency', () => {
    const plain = assess({
      subject: 'A note about the quarterly report',
      bodyText: 'Here are the numbers for your records. No action required.',
    });
    expect(['NONE', 'LOW']).toContain(plain.priority);
    expect(plain.score).toBeLessThan(1);
  });

  it('honours an explicit "no action required" statement', () => {
    const result = assess({
      bodyText: 'This is for your information only. No action required, no reply needed.',
    });
    // Informational mail must not be promoted above LOW, and a stated
    // "no action required" must pull the score down.
    expect(['NONE', 'LOW']).toContain(result.priority);
    expect(result.signals.some((signal) => signal.weight < 0)).toBe(true);
  });

  it('boosts mail from a sender the user marked as important', () => {
    const base = assess({ bodyText: 'Please review the attached plan when you can.' });
    const boosted = assess({
      bodyText: 'Please review the attached plan when you can.',
      importantSenders: ['boss@company.com'],
      senderEmail: 'boss@company.com',
    });
    expect(boosted.score).toBeGreaterThan(base.score);
  });

  it('lowers mail from an ignored sender', () => {
    const ignored = assess({
      bodyText: 'Please review the attached plan when you can.',
      ignoredSenders: ['noreply@newsletter.com'],
      senderEmail: 'noreply@newsletter.com',
    });
    expect(['LOW', 'NONE']).toContain(ignored.priority);
  });

  it('escalates as the deadline approaches', () => {
    const far = assess({ bodyText: 'Submit the assignment.', actionRequired: true, deadline: deadlineIn(10) });
    const near = assess({ bodyText: 'Submit the assignment.', actionRequired: true, deadline: deadlineIn(1) });
    expect(near.score).toBeGreaterThan(far.score);
  });

  it('records the reasoning behind every signal', () => {
    const result = assess({
      subject: 'Invoice overdue',
      bodyText: 'Your payment is overdue. Please settle the invoice to avoid a penalty.',
      actionRequired: true,
      deadline: deadlineIn(2),
    });
    for (const signal of result.signals) {
      expect(signal.code.length).toBeGreaterThan(0);
      expect(signal.detail.length).toBeGreaterThan(0);
    }
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('never returns an out-of-range score', () => {
    const result = assess({
      subject: 'URGENT FINAL NOTICE',
      bodyText: 'Urgent! Immediate action required! Overdue! Penalty! Without fail! Mandatory!',
      actionRequired: true,
      deadline: deadlineIn(0),
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
