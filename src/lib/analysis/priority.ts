/**
 * Priority engine (§10).
 *
 * Priority is derived from *evidence*, never from the presence of words like
 * "important" alone. Each contributing signal is recorded so the UI can show
 * the reasoning behind the assigned priority.
 */

import type { EmailPriority } from '@/lib/types/domain';
import type { DetectedDeadline } from '@/lib/types/domain';
import { daysBetween, getZonedParts, parseYmd, safeTimezone } from './dates';

export interface PriorityInput {
  subject: string | null;
  bodyText: string | null;
  senderEmail: string | null;
  actionRequired: boolean;
  deadline: DetectedDeadline | null;
  /** Addresses the user marked as important in preferences (§36). */
  importantSenders: string[];
  /** Addresses the user muted. */
  ignoredSenders: string[];
  referenceInstant: Date;
  timezone: string;
}

export interface PrioritySignal {
  code: string;
  weight: number;
  detail: string;
}

export interface PriorityAssessment {
  priority: EmailPriority;
  score: number;
  reason: string;
  signals: PrioritySignal[];
  confidence: number;
}

// ── Lexicons ─────────────────────────────────────────────────────────────────

/** Genuine, specific urgency markers. Vague emphasis ("important", "please note") is excluded. */
const EXPLICIT_URGENCY = [
  { pattern: /\burgent(ly)?\b/i, weight: 1.2, detail: 'Message states it is urgent' },
  { pattern: /\bimmediate(ly)?\b/i, weight: 1.0, detail: 'Immediate action requested' },
  { pattern: /\btime[- ]sensitive\b/i, weight: 1.0, detail: 'Marked time-sensitive' },
  { pattern: /\bfinal (?:reminder|notice|warning)\b/i, weight: 1.4, detail: 'Final reminder / notice' },
  { pattern: /\boverdue\b/i, weight: 1.3, detail: 'Already overdue' },
  { pattern: /\blast (?:chance|date|day)\b/i, weight: 1.1, detail: 'Last chance / final date' },
  { pattern: /\basap\b/i, weight: 1.0, detail: 'ASAP requested' },
  { pattern: /\bpenalt(?:y|ies)\b/i, weight: 0.9, detail: 'Penalty mentioned' },
  { pattern: /\bwill be (?:rejected|failed|disqualified|withheld)\b/i, weight: 1.3, detail: 'Consequence stated' },
  { pattern: /\blate submission\b/i, weight: 1.0, detail: 'Late-submission policy referenced' },
  { pattern: /\bexpires? (?:today|tomorrow)\b/i, weight: 1.2, detail: 'Expiring within 48 hours' },
];

/** Consequences — a stated negative outcome raises priority. */
const CONSEQUENCE_MARKERS = [
  { pattern: /\bmust\b/i, weight: 0.5, detail: 'Mandatory language ("must")' },
  { pattern: /\brequired\b/i, weight: 0.45, detail: 'Explicitly required' },
  { pattern: /\bmandatory\b/i, weight: 0.6, detail: 'Described as mandatory' },
  { pattern: /\bwithout fail\b/i, weight: 0.7, detail: 'Emphasis on mandatory completion' },
  { pattern: /\bno exceptions?\b/i, weight: 0.6, detail: 'No exceptions stated' },
  { pattern: /\botherwise\b/i, weight: 0.3, detail: 'Conditional consequence implied' },
  { pattern: /\bfail(?:ure)?\b/i, weight: 0.5, detail: 'Failure consequence referenced' },
  { pattern: /\bfine\b|\bpenalty charge\b/i, weight: 0.6, detail: 'Financial consequence referenced' },
];

/** Signals that lower priority. */
const LOW_PRIORITY_MARKERS = [
  { pattern: /\bno action (?:is )?(?:required|needed)\b/i, weight: -1.6, detail: 'Explicitly says no action required' },
  { pattern: /\bfor your (?:information|reference|records)\b/i, weight: -1.2, detail: 'FYI — informational only' },
  { pattern: /\bno reply (?:is )?(?:needed|required|necessary)\b/i, weight: -1.5, detail: 'No reply needed' },
  { pattern: /\bjust (?:a )?(?:quick )?note\b/i, weight: -0.7, detail: 'Casual note' },
  { pattern: /\bnewsletter\b/i, weight: -1.0, detail: 'Newsletter' },
  { pattern: /\bunsubscribe\b/i, weight: -0.9, detail: 'Bulk/marketing content' },
  { pattern: /\b(?:sale|discount|offer|deal|promo(?:tion)?)\b/i, weight: -0.8, detail: 'Promotional content' },
  { pattern: /\bthank you for\b|\bthanks for\b/i, weight: -0.6, detail: 'Acknowledgment / thanks' },
  { pattern: /\bautomated (?:message|notification)\b/i, weight: -0.6, detail: 'Automated notification' },
  { pattern: /\bdo not reply\b/i, weight: -0.7, detail: 'Do-not-reply sender' },
];

const MEETING_NEAR_TERMS = [
  { pattern: /\b(?:meeting|call|interview|review|standup|sync|presentation|viva)\b/i, weight: 0.5, detail: 'Scheduled interaction' },
  { pattern: /\b(?:cancelled|canceled|postponed|rescheduled)\b/i, weight: 0.6, detail: 'Schedule change announced' },
];

const FINANCE_TERMS = [
  { pattern: /\b(?:invoice|payment due|amount due|bill|premium|emi|installment|instalment)\b/i, weight: 0.8, detail: 'Financial obligation' },
  { pattern: /\b(?:overdue|due date|last date for payment)\b/i, weight: 0.6, detail: 'Payment timing referenced' },
];

const ACADEMIC_TERMS = [
  { pattern: /\b(?:assignment|submission|exam|quiz|viva|thesis|dissertation|project report|certification)\b/i, weight: 0.7, detail: 'Academic deliverable' },
  { pattern: /\b(?:grades?|marks?|credits?|semester)\b/i, weight: 0.3, detail: 'Academic context' },
];

// ── Scoring ──────────────────────────────────────────────────────────────────

export function assessPriority(input: PriorityInput): PriorityAssessment {
  const tz = safeTimezone(input.timezone);
  const signals: PrioritySignal[] = [];
  const haystack = `${input.subject ?? ''}\n${input.bodyText ?? ''}`;
  const senderEmail = (input.senderEmail ?? '').toLowerCase();

  const add = (code: string, weight: number, detail: string) => {
    if (weight === 0) return;
    signals.push({ code, weight, detail });
  };

  // 0. User-defined importance overrides everything else in weight.
  if (senderEmail && input.importantSenders.some((s) => s.toLowerCase() === senderEmail)) {
    add('SENDER_IMPORTANT', 1.8, 'Sender is marked as important by you');
  }
  const ignored = senderEmail && input.ignoredSenders.some((s) => s.toLowerCase() === senderEmail);

  // 1. Explicit urgency
  for (const entry of EXPLICIT_URGENCY) {
    if (entry.pattern.test(haystack)) add('EXPLICIT_URGENCY', entry.weight, entry.detail);
  }

  // 2. Required action
  if (input.actionRequired) {
    add('ACTION_REQUIRED', 0.7, 'Email requires an action from you');
  }

  // 3. Deadline proximity — the strongest objective signal.
  if (input.deadline?.date) {
    const parsed = parseYmd(input.deadline.date);
    if (parsed) {
      const now = getZonedParts(input.referenceInstant, tz);
      const days = daysBetween(now, parsed);
      if (days < 0) {
        add('DEADLINE_PASSED', 1.5, `Stated deadline passed ${Math.abs(days)} day(s) ago`);
      } else if (days === 0) {
        add('DEADLINE_TODAY', 2.0, 'Stated deadline is today');
      } else if (days === 1) {
        add('DEADLINE_24H', 1.6, 'Stated deadline is within 24–48 hours');
      } else if (days <= 3) {
        add('DEADLINE_3D', 1.1, `Stated deadline is in ${days} days`);
      } else if (days <= 7) {
        add('DEADLINE_WEEK', 0.6, `Stated deadline is within a week (${days} days)`);
      } else if (days <= 14) {
        add('DEADLINE_2W', 0.3, `Stated deadline is in ${days} days`);
      }
      if (input.deadline.confidence < 0.6) {
        add('DEADLINE_UNCERTAIN', -0.3, 'Deadline was detected with low confidence');
      }
    }
  }

  // 4. Consequences
  for (const entry of CONSEQUENCE_MARKERS) {
    if (entry.pattern.test(haystack)) add('CONSEQUENCE', entry.weight, entry.detail);
  }

  // 5. Time sensitivity of scheduled events
  for (const entry of MEETING_NEAR_TERMS) {
    if (entry.pattern.test(haystack)) add('SCHEDULED_EVENT', entry.weight, entry.detail);
  }

  // 6. Domain weight — obligations outrank chatter
  for (const entry of FINANCE_TERMS) {
    if (entry.pattern.test(haystack)) add('FINANCE_OBLIGATION', entry.weight, entry.detail);
  }
  for (const entry of ACADEMIC_TERMS) {
    if (entry.pattern.test(haystack)) add('ACADEMIC_DELIVERABLE', entry.weight, entry.detail);
  }

  // 7. De-prioritising signals
  let lowPriorityHits = 0;
  for (const entry of LOW_PRIORITY_MARKERS) {
    if (entry.pattern.test(haystack)) {
      lowPriorityHits += 1;
      add('LOW_PRIORITY_MARKER', entry.weight, entry.detail);
    }
  }

  // 8. Sender heuristics that are evidence-based, not guesses
  if (senderEmail && /(?:^|[.@-])(?:noreply|no-reply|donotreply|do-not-reply|notifications?|mailer|newsletter|updates?)(?:[.@-]|$)/i.test(senderEmail)) {
    add('AUTOMATED_SENDER', -0.6, 'Sender address indicates automated mail');
  }
  if (input.ignoredSenders.length > 0 && ignored) {
    add('SENDER_MUTED', -2.0, 'Sender is muted in your preferences');
  }

  if (haystack.trim().length === 0) {
    return {
      priority: 'NONE',
      score: 0,
      reason: 'No content available to assess priority.',
      signals,
      confidence: 0.2,
    };
  }

  const score = signals.reduce((total, signal) => total + signal.weight, 0);
  const priority = toPriorityBand(score, input.actionRequired, lowPriorityHits);

  return {
    priority,
    score: Number(score.toFixed(2)),
    reason: buildReason(signals, priority),
    signals,
    confidence: confidenceForSignals(signals, priority),
  };
}

function toPriorityBand(score: number, actionRequired: boolean, lowHits: number): EmailPriority {
  if (score >= 3.2) return 'CRITICAL';
  if (score >= 2.0) return 'HIGH';
  if (score >= 1.0) return 'MEDIUM';
  if (score >= 0.25) return 'LOW';
  if (score > -0.5 && actionRequired && lowHits === 0) return 'LOW';
  if (score > 0.1) return 'LOW';
  return 'NONE';
}

function confidenceForSignals(signals: PrioritySignal[], priority: EmailPriority): number {
  const magnitude = Math.abs(signals.reduce((total, signal) => total + signal.weight, 0));
  const spread = new Set(signals.map((signal) => signal.code)).size;
  const base = 0.55 + Math.min(magnitude, 4) * 0.07 + Math.min(spread, 5) * 0.03;
  const penalty = priority === 'MEDIUM' ? 0.06 : 0;
  return Number(Math.max(0.3, Math.min(0.96, base - penalty)).toFixed(3));
}

function buildReason(signals: PrioritySignal[], priority: EmailPriority): string {
  if (signals.length === 0) {
    return 'No urgency or obligation indicators were found in this message.';
  }
  const positive = signals
    .filter((signal) => signal.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((signal) => lowerFirst(signal.detail));
  const negative = signals
    .filter((signal) => signal.weight < 0)
    .sort((a, b) => a.weight - b.weight)
    .slice(0, 2)
    .map((signal) => lowerFirst(signal.detail));

  if (positive.length === 0) {
    return `Kept at ${priority.toLowerCase()} priority: ${negative.join('; ')}.`;
  }
  const head = `${capitalise(positive.join('; '))}.`;
  return negative.length > 0 ? `${head} Lowered by: ${negative.join('; ')}.` : head;
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase() ?? ''}${value.slice(1)}`;
}

function capitalise(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}
