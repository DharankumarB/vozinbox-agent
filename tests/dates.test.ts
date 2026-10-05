import { describe, expect, it } from 'vitest';
import {
  addDays,
  describeDeadline,
  extractDeadline,
  extractTime,
  findDateMatches,
  formatYmd,
  getZonedParts,
  isRealDate,
  isValidTimezone,
  parseYmd,
  safeTimezone,
  sentenceAround,
} from '@/lib/analysis/dates';

/**
 * §12 — deadline extraction must never invent a date or a time.
 * Every case here encodes one of the rules from the product spec.
 */

const JOHANNESBURG = 'Africa/Johannesburg';

/** 2026-03-10 is a Tuesday; 09:00 in Johannesburg. */
const REFERENCE = new Date('2026-03-10T07:00:00.000Z');

function extract(text: string, timezone = JOHANNESBURG, reference = REFERENCE) {
  return extractDeadline(text, { referenceInstant: reference, timezone });
}

describe('timezone helpers', () => {
  it('validates IANA timezones and falls back safely', () => {
    expect(isValidTimezone('Africa/Johannesburg')).toBe(true);
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(safeTimezone(null)).toBe('UTC');
    expect(safeTimezone('Mars/Olympus')).toBe('UTC');
    expect(safeTimezone('Africa/Johannesburg')).toBe(JOHANNESBURG);
  });

  it('resolves wall-clock parts in the user timezone', () => {
    const parts = getZonedParts(REFERENCE, JOHANNESBURG);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(3);
    expect(parts.day).toBe(10);
    expect(parts.hour).toBe(9);
    expect(parts.weekday).toBe(2); // Tuesday
  });

  it('round-trips ISO dates and rejects impossible ones', () => {
    expect(formatYmd(parseYmd('2026-03-10')!)).toBe('2026-03-10');
    expect(parseYmd('2026-13-01')).toBeNull();
    expect(isRealDate(2026, 2, 29)).toBe(false);
    expect(isRealDate(2024, 2, 29)).toBe(true);
  });

  it('adds days across month boundaries', () => {
    const parts = addDays(getZonedParts(REFERENCE, JOHANNESBURG), 25);
    expect(formatYmd(parts)).toBe('2026-04-04');
  });
});

describe('extractTime', () => {
  it('reads unambiguous clock times only', () => {
    expect(extractTime('submit by 5 pm')?.time).toBe('17:00');
    expect(extractTime('the call is at 17:00')?.time).toBe('17:00');
    expect(extractTime('join us at noon')?.time).toBe('12:00');
    expect(extractTime('finish before midnight')?.time).toBe('00:00');
  });

  it('does not invent a time from a bare number', () => {
    expect(extractTime('the budget is 5 and the team is 12 people')).toBeNull();
  });
});

describe('deadline extraction — explicit dates', () => {
  it('resolves a written date with a stated time', () => {
    const { deadline } = extract('Please submit the report by 5 pm on 20 March 2026.');
    expect(deadline?.date).toBe('2026-03-20');
    expect(deadline?.time).toBe('17:00');
    expect(deadline?.type).toBe('EXPLICIT');
    expect(deadline?.source_sentence).toContain('submit the report');
  });

  it('keeps the time null when the message states only a date', () => {
    const { deadline } = extract('The deadline for the assignment is 20 March 2026.');
    expect(deadline?.date).toBe('2026-03-20');
    expect(deadline?.time).toBeNull();
  });

  it('reads ISO dates', () => {
    const { deadline } = extract('Deadline: 2026-03-27');
    expect(deadline?.date).toBe('2026-03-27');
  });
});

describe('deadline extraction — relative dates', () => {
  it('resolves "tomorrow" against the email timestamp in the user timezone', () => {
    const { deadline } = extract('Reminder: the form closes tomorrow.');
    expect(deadline?.date).toBe('2026-03-11');
    expect(deadline?.type).toBe('RELATIVE');
  });

  it('resolves weekday names forward, never backwards', () => {
    // Tuesday + "by Friday" = the Friday of the same week (2026-03-13).
    const { deadline } = extract('Send your slides by Friday.');
    expect(deadline?.date).toBe('2026-03-13');
  });

  it('treats a vague phrase as ambiguous instead of guessing a date', () => {
    const { deadline, notes } = extract('Please settle the invoice by the end of the month.');
    expect(deadline?.date ?? null).toBeNull();
    expect(notes).toContain('AMBIGUOUS_DATE');
  });

  it('resolves "in 3 days" from the email timestamp', () => {
    const { deadline } = extract('The audit happens in 3 days.');
    expect(deadline?.date).toBe('2026-03-13');
  });

  it('uses the timezone, not the server timezone, to decide "today"', () => {
    // 22:30 UTC on 2026-03-10 is already 00:30 on the 11th in Johannesburg.
    const late = new Date('2026-03-10T22:30:00.000Z');
    const { deadline } = extract('This is due tomorrow.', JOHANNESBURG, late);
    expect(deadline?.date).toBe('2026-03-12');
  });
});

describe('deadline extraction — ambiguity is surfaced, not guessed', () => {
  it('flags a bare slash date as ambiguous and marks it low confidence', () => {
    const matches = findDateMatches('Due 05/06/2026', {
      referenceInstant: REFERENCE,
      timezone: JOHANNESBURG,
    });
    const ambiguous = matches.find((match) => match.notes.includes('AMBIGUOUS_DATE_FORMAT'));
    expect(ambiguous).toBeDefined();
    expect(ambiguous?.confidence).toBeLessThanOrEqual(0.6);
  });

  it('returns nothing when the message contains no date', () => {
    const { deadline, dates } = extract('Thanks for the update — looks good to me.');
    expect(deadline).toBeNull();
    expect(dates).toHaveLength(0);
  });

  it('reports an empty body instead of guessing', () => {
    const result = extract('');
    expect(result.deadline).toBeNull();
    expect(result.notes).toContain('NO_BODY_TEXT');
  });

  it('infers the year for a date that has already passed this year', () => {
    // The message arrives in December; "15 January" must mean next year.
    const december = new Date('2026-12-20T09:00:00.000Z');
    const { deadline } = extract('The new term begins on 15 January.', JOHANNESBURG, december);
    expect(deadline?.date).toBe('2027-01-15');
  });
});

describe('deadline helpers', () => {
  it('describes a deadline for display without inventing a time', () => {
    const bare = describeDeadline(
      { date: '2026-03-20', time: null, type: 'EXPLICIT', timezone: null, source_sentence: null, confidence: 0.9 },
      JOHANNESBURG,
      { now: REFERENCE },
    );
    expect(bare).toContain('Mar 20');
    expect(bare).not.toMatch(/\d{1,2}:\d{2}/);

    const withTime = describeDeadline(
      { date: '2026-03-11', time: '17:00', type: 'EXPLICIT', timezone: null, source_sentence: null, confidence: 0.9 },
      JOHANNESBURG,
      { now: REFERENCE },
    );
    expect(withTime).toMatch(/5:00\s?PM/);
  });

  it('extracts the sentence around a match', () => {
    const text = 'Intro line. Please submit the form by 20 March 2026. Closing line.';
    const index = text.indexOf('20 March');
    const sentence = sentenceAround(text, index, '20 March 2026'.length);
    expect(sentence).toBe('Please submit the form by 20 March 2026.');
  });
});
